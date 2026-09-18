#!/usr/bin/env python3
"""Restore pinned public sources and Binance public-archive CSVs; standard library only."""
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent
for item in json.loads((ROOT / "sources-manifest.json").read_text()):
    data = urllib.request.urlopen(item["url"]).read()
    assert hashlib.sha256(data).hexdigest() == item["sha256"], item["url"]
    target = ROOT / "sources" / item["repo"] / item["path"]
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
for item in json.loads((ROOT / "data/manifest.json").read_text())["sources"]:
    raw = urllib.request.urlopen(item["url"]).read()
    assert hashlib.sha256(raw).hexdigest() == item["zip_sha256"], item["url"]
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        data = archive.read(item["filename"])
    assert hashlib.sha256(data).hexdigest() == item["csv_sha256"], item["url"]
    (ROOT / "data" / item["filename"]).write_bytes(data)
print("Pinned public sources and archive data restored with matching SHA-256 checksums.")
