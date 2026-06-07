import modal

app = modal.App("podcast-kb-transcribe")

# Persist the ~3GB large-v3 weights across cold starts: download once into a Volume,
# reuse on every subsequent run (faster + cheaper — no repeated download time).
CACHE_DIR = "/cache"
model_cache = modal.Volume.from_name("whisper-cache", create_if_missing=True)

# faster-whisper (CTranslate2) loads CUDA libs (libcublas, libcudnn) at runtime,
# so the image must be built on an NVIDIA CUDA + cuDNN base — debian_slim lacks them.
image = (
    modal.Image.from_registry(
        "nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04", add_python="3.11"
    )
    .apt_install("ffmpeg")
    .pip_install("faster-whisper==1.0.3", "requests==2.32.3", "fastapi[standard]")
)


@app.function(image=image, gpu="A10G", timeout=1800, volumes={CACHE_DIR: model_cache})
def transcribe(audio_url: str, episode_id: str, callback_url: str, secret: str):
    import tempfile
    import requests
    from faster_whisper import WhisperModel

    try:
        # Download audio
        with tempfile.NamedTemporaryFile(suffix=".audio", delete=False) as f:
            with requests.get(audio_url, stream=True, timeout=300) as r:
                r.raise_for_status()
                for chunk in r.iter_content(chunk_size=1 << 20):
                    f.write(chunk)
            audio_path = f.name

        import os

        model_cache.reload()
        snapshot_present = os.path.isdir(
            os.path.join(CACHE_DIR, "models--Systran--faster-whisper-large-v3")
        )
        # When the snapshot is already cached, load fully offline so faster-whisper
        # doesn't ping the HF Hub to resolve the revision (avoids the unauthenticated
        # warning + a network round-trip). First run downloads, then commits.
        model = WhisperModel(
            "large-v3",
            device="cuda",
            compute_type="float16",
            download_root=CACHE_DIR,
            local_files_only=snapshot_present,
        )
        if not snapshot_present:
            model_cache.commit()
        segments_iter, _info = model.transcribe(audio_path, vad_filter=True)

        segments = []
        full_text_parts = []
        for s in segments_iter:
            segments.append({"start": s.start, "end": s.end, "text": s.text.strip()})
            full_text_parts.append(s.text.strip())

        payload = {
            "episode_id": episode_id,
            "secret": secret,
            "transcript": " ".join(full_text_parts),
            "segments": segments,
        }
    except Exception as e:
        payload = {"episode_id": episode_id, "secret": secret, "error": str(e)}

    resp = requests.post(callback_url, json=payload, timeout=60)
    resp.raise_for_status()


@app.function(image=image)
@modal.fastapi_endpoint(method="POST")
def web(body: dict):
    from fastapi import Response

    # Validate the shared secret before doing any work.
    if not body.get("secret"):
        return Response(content='{"error":"missing secret"}', status_code=401, media_type="application/json")

    # Spawn the long-running job and return immediately.
    transcribe.spawn(
        audio_url=body["audio_url"],
        episode_id=body["episode_id"],
        callback_url=body["callback_url"],
        secret=body["secret"],
    )
    return {"status": "accepted"}
