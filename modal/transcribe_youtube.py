import modal

app = modal.App("podcast-kb-transcribe-youtube")

CACHE_DIR = "/cache"  # shared whisper weights (same volume as transcribe.py)
model_cache = modal.Volume.from_name("whisper-cache", create_if_missing=True)

WARP_DIR = "/warp"  # persists the registered WARP identity across cold starts
warp_cache = modal.Volume.from_name("warp-cache", create_if_missing=True)

SOCKS_PORT = 25344

# Release URLs verified 2026-06 (wgcf v2.2.31 is the latest pinned build; wireproxy
# uses the active windtf fork via its stable `latest` asset, so it tracks upstream
# without a hardcoded version). If the image build 404s, re-check these.
WGCF_URL = "https://github.com/ViRb3/wgcf/releases/download/v2.2.31/wgcf_2.2.31_linux_amd64"
WIREPROXY_URL = "https://github.com/windtf/wireproxy/releases/latest/download/wireproxy_linux_amd64.tar.gz"

image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04", add_python="3.11"
    )
    .apt_install("ffmpeg", "wget", "ca-certificates")
    .pip_install(
        "faster-whisper==1.0.3",
        "requests==2.32.3",
        "fastapi[standard]",
        # Unpinned: a stale yt-dlp is the main cause of YouTube extraction breaking,
        # so each image build picks up the latest. Pin to a known-good version only
        # if a future release regresses.
        "yt-dlp",
    )
    .run_commands(
        f"wget -q -O /usr/local/bin/wgcf {WGCF_URL} && chmod +x /usr/local/bin/wgcf",
        f"wget -q -O /tmp/wp.tar.gz {WIREPROXY_URL} && tar -xzf /tmp/wp.tar.gz -C /usr/local/bin wireproxy && chmod +x /usr/local/bin/wireproxy",
    )
    # ship the pure helpers into the image
    .add_local_python_source("youtube_helpers")
)


def _start_warp():
    """Register (once, cached) a free WARP identity and start wireproxy as a
    userspace SOCKS5 proxy on 127.0.0.1:SOCKS_PORT. Returns when WARP is up."""
    import os
    import subprocess
    import time
    import requests
    from youtube_helpers import build_wireproxy_config

    os.makedirs(WARP_DIR, exist_ok=True)
    account = os.path.join(WARP_DIR, "wgcf-account.toml")
    profile = os.path.join(WARP_DIR, "wgcf-profile.conf")
    wp_conf = os.path.join(WARP_DIR, "wireproxy.conf")

    warp_cache.reload()
    if not os.path.exists(account):
        # register a fresh anonymous WARP identity (accepts TOS) + generate wg profile
        subprocess.run(
            ["wgcf", "register", "--accept-tos", "--config", account],
            check=True, cwd=WARP_DIR,
        )
    if not os.path.exists(profile):
        subprocess.run(
            ["wgcf", "generate", "--config", account, "--profile", profile],
            check=True, cwd=WARP_DIR,
        )
    with open(profile) as f:
        wg = f.read()
    with open(wp_conf, "w") as f:
        f.write(build_wireproxy_config(wg, SOCKS_PORT))
    warp_cache.commit()

    # start the userspace proxy (no TUN / NET_ADMIN needed)
    subprocess.Popen(["wireproxy", "-c", wp_conf])

    # health gate: confirm WARP is the egress before doing any YouTube work
    proxies = {"http": f"socks5://127.0.0.1:{SOCKS_PORT}", "https": f"socks5://127.0.0.1:{SOCKS_PORT}"}
    for _ in range(30):
        try:
            r = requests.get("https://www.cloudflare.com/cdn-cgi/trace", proxies=proxies, timeout=5)
            if "warp=on" in r.text or "warp=plus" in r.text:
                return proxies
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError("WARP egress did not come up")


@app.function(
    image=image,
    gpu="A10G",
    timeout=1800,
    volumes={CACHE_DIR: model_cache, WARP_DIR: warp_cache},
)
def transcribe_youtube(video_url: str, item_id: str, callback_url: str, secret: str):
    import os
    import tempfile
    import requests
    from faster_whisper import WhisperModel
    from yt_dlp import YoutubeDL
    from youtube_helpers import map_ytdlp_metadata

    try:
        _start_warp()
        socks = f"socks5://127.0.0.1:{SOCKS_PORT}"

        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "audio.%(ext)s")
            ydl_opts = {
                "format": "bestaudio/best",
                "outtmpl": out,
                "proxy": socks,
                "quiet": True,
                "noplaylist": True,
            }
            with YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(video_url, download=True)
                audio_path = ydl.prepare_filename(info)

            metadata = map_ytdlp_metadata(info)

            # transcribe (identical cache-aware load to transcribe.py)
            model_cache.reload()
            snapshot = os.path.isdir(
                os.path.join(CACHE_DIR, "models--Systran--faster-whisper-large-v3")
            )
            model = WhisperModel(
                "large-v3",
                device="cuda",
                compute_type="float16",
                download_root=CACHE_DIR,
                local_files_only=snapshot,
            )
            if not snapshot:
                model_cache.commit()
            segments_iter, _info = model.transcribe(audio_path, vad_filter=True)

            segments = []
            parts = []
            for s in segments_iter:
                segments.append({"start": s.start, "end": s.end, "text": s.text.strip()})
                parts.append(s.text.strip())

            payload = {
                "item_id": item_id,
                "secret": secret,
                "metadata": metadata,
                "transcript": " ".join(parts),
                "segments": segments,
            }
    except Exception as e:
        payload = {"item_id": item_id, "secret": secret, "error": str(e)}

    resp = requests.post(callback_url, json=payload, timeout=60)
    resp.raise_for_status()


# The public endpoint compares the provided secret against MODAL_WEBHOOK_SECRET
# (supplied via a Modal secret named "podcast-kb-webhook"), so a leaked endpoint
# URL can't be used to spawn GPU jobs. Create it once with:
#   modal secret create podcast-kb-webhook MODAL_WEBHOOK_SECRET=<same value as the app>
@app.function(image=image, secrets=[modal.Secret.from_name("podcast-kb-webhook")])
@modal.fastapi_endpoint(method="POST")
def web(body: dict):
    import hmac
    import os
    from fastapi import Response

    def unauthorized():
        return Response(
            content='{"error":"unauthorized"}', status_code=401, media_type="application/json"
        )

    expected = os.environ.get("MODAL_WEBHOOK_SECRET")
    provided = body.get("secret")
    if not expected or not isinstance(provided, str) or not hmac.compare_digest(provided, expected):
        return unauthorized()

    missing = [k for k in ("video_url", "item_id", "callback_url") if not body.get(k)]
    if missing:
        return Response(
            content='{"error":"missing fields"}', status_code=400, media_type="application/json"
        )

    transcribe_youtube.spawn(
        video_url=body["video_url"],
        item_id=body["item_id"],
        callback_url=body["callback_url"],
        secret=body["secret"],
    )
    return {"status": "accepted"}
