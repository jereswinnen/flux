"""Pure helpers for the YouTube transcription Modal function.

Stdlib-only and free of any `modal`/`yt_dlp` imports so they can be unit-tested
without those packages installed.
"""
from typing import Optional


def iso_from_upload_date(d: Optional[str]) -> Optional[str]:
    """yt-dlp `upload_date` is 'YYYYMMDD'. Return 'YYYY-MM-DD', or None if absent/malformed."""
    if not d or len(d) != 8 or not d.isdigit():
        return None
    return f"{d[0:4]}-{d[4:6]}-{d[6:8]}"


def map_ytdlp_metadata(info: dict) -> dict:
    """Map a yt-dlp info dict to the callback `metadata` shape the app expects.
    Only includes keys that are present, so the callback's per-field guards apply."""
    meta: dict = {}
    if info.get("title"):
        meta["title"] = info["title"]
    channel = info.get("channel") or info.get("uploader")
    if channel:
        meta["channelName"] = channel
    if info.get("thumbnail"):
        meta["thumbnailUrl"] = info["thumbnail"]
    duration = info.get("duration")
    if isinstance(duration, (int, float)):
        meta["durationSec"] = int(duration)
    iso = iso_from_upload_date(info.get("upload_date"))
    if iso:
        meta["publishedAt"] = iso
    return meta


def build_wireproxy_config(wg_profile: str, socks_port: int) -> str:
    """wireproxy uses a standard WireGuard config plus a [Socks5] section.
    `wg_profile` is the output of `wgcf generate`."""
    return wg_profile.rstrip() + f"\n\n[Socks5]\nBindAddress = 127.0.0.1:{socks_port}\n"
