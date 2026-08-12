#!/usr/bin/env python3
"""Merge channels_seed.json + naming.json + tracks/<slug>.json + scenes/<slug>.svg
into the app manifest channels.json. Channels missing tracks or a scene are
included with "ready": false so the app can skip them gracefully."""
import json, os

BASE = os.path.dirname(os.path.abspath(__file__))
seed = json.load(open(f"{BASE}/data/channels_seed.json"))["channels"]
naming = {}
if os.path.exists(f"{BASE}/data/naming.json"):
    naming = json.load(open(f"{BASE}/data/naming.json"))

out = []
for ch in seed:
    slug = ch["slug"]
    ch = dict(ch)
    ch.update({k: v for k, v in naming.get(slug, {}).items() if v})
    tracks_path = f"{BASE}/data/tracks/{slug}.json"
    scene_path = f"{BASE}/scenes/{slug}.svg"
    ch["hasScene"] = os.path.exists(scene_path)
    ch["tracks"] = []
    if os.path.exists(tracks_path):
        try:
            ch["tracks"] = json.load(open(tracks_path))["tracks"]
        except Exception as e:
            print(f"  !! {slug}: bad tracks json ({e})")
    for t in ch["tracks"]:
        t.setdefault("durationSec", 300)
    ch["totalSec"] = sum(t["durationSec"] for t in ch["tracks"])
    ch["ready"] = bool(ch["tracks"]) and ch["hasScene"]
    out.append(ch)

ready = [c for c in out if c["ready"]]
json.dump({"channels": out}, open(f"{BASE}/channels.json", "w"), ensure_ascii=False)
print(f"merged {len(out)} channels, {len(ready)} ready "
      f"({sum(len(c['tracks']) for c in out)} tracks total)")
for c in out:
    if not c["ready"]:
        print(f"  not ready: {c['slug']} (scene={c['hasScene']}, tracks={len(c['tracks'])})")
