import sys
from youtube_helpers import iso_from_upload_date, map_ytdlp_metadata, build_wireproxy_config


def check(name, cond):
    if not cond:
        print(f"FAIL: {name}")
        sys.exit(1)
    print(f"ok: {name}")


check("upload date -> iso", iso_from_upload_date("20260612") == "2026-06-12")
check("none upload date", iso_from_upload_date(None) is None)
check("bad upload date", iso_from_upload_date("2026") is None)

info = {
    "title": "Real Title",
    "channel": "Some Channel",
    "uploader": "fallback uploader",
    "thumbnail": "https://i.ytimg.com/x.jpg",
    "duration": 1234.7,
    "upload_date": "20260101",
    "id": "dQw4w9WgXcQ",
}
m = map_ytdlp_metadata(info)
check("title", m["title"] == "Real Title")
check("channelName prefers channel", m["channelName"] == "Some Channel")
check("thumbnailUrl", m["thumbnailUrl"] == "https://i.ytimg.com/x.jpg")
check("durationSec int", m["durationSec"] == 1234)
check("publishedAt iso", m["publishedAt"] == "2026-01-01")

m2 = map_ytdlp_metadata({"title": "T", "uploader": "Up"})
check("channelName falls back to uploader", m2["channelName"] == "Up")
check("missing fields omitted", "thumbnailUrl" not in m2 and "durationSec" not in m2)

cfg = build_wireproxy_config("[Interface]\nPrivateKey = abc\n", 25344)
check("config keeps interface", "[Interface]" in cfg and "PrivateKey = abc" in cfg)
check("config adds socks5", "[Socks5]" in cfg and "BindAddress = 127.0.0.1:25344" in cfg)

print("ALL PASS")
