import modal

app = modal.App("podcast-kb-transcribe-youtube")

CACHE_DIR = "/cache"  # shared whisper weights (same volume as transcribe.py)
model_cache = modal.Volume.from_name("whisper-cache", create_if_missing=True)

WARP_DIR = "/warp"  # persists the registered WARP identity across cold starts
warp_cache = modal.Volume.from_name("warp-cache", create_if_missing=True)

SOCKS_PORT = 25344

# NOTE (version risk): confirm these release URLs are current at build time — they
# change. A stale URL fails the image build with a 404.
WGCF_URL = "https://github.com/ViRb3/wgcf/releases/download/v2.2.27/wgcf_2.2.27_linux_amd64"
WIREPROXY_URL = "https://github.com/whyvl/wireproxy/releases/download/v1.0.9/wireproxy_linux_amd64.tar.gz"

image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04", add_python="3.11"
    )
    .apt_install("ffmpeg", "wget", "ca-certificates")
    .pip_install(
        "faster-whisper==1.0.3",
        "requests==2.32.3",
        "fastapi[standard]",
        "yt-dlp==2025.6.9",  # pin; bump when YouTube changes its player
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
        proxies = _start_warp()
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


@app.function(image=image)
@modal.fastapi_endpoint(method="POST")
def web(body: dict):
    from fastapi import Response

    if not body.get("secret"):
        return Response(content='{"error":"missing secret"}', status_code=401, media_type="application/json")

    transcribe_youtube.spawn(
        video_url=body["video_url"],
        item_id=body["item_id"],
        callback_url=body["callback_url"],
        secret=body["secret"],
    )
    return {"status": "accepted"}
