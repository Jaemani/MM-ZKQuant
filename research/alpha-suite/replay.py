"""Reproducible archival signal replay plus explicitly synthetic custom examples.

No P&L simulation, execution, provider authentication, or historical publication
proof. Historical availability is an ASSUMED LAG, not observed point-in-time data.
"""
import csv
import hashlib
import io
import json
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from urllib.request import urlopen
from zipfile import ZipFile

from strategies import DAY, FEATURES, REQUIRED, Feature, decide
from test_strategies import CUTOFF, fixture

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def download(name, url):
    path = DATA / name
    manifest_path = DATA / (name + ".manifest.json")
    if path.exists():
        manifest = json.loads(manifest_path.read_text())
        if digest(path.read_bytes()) != manifest["sha256"]:
            raise ValueError(f"snapshot hash mismatch: {name}")
        return path.read_bytes()
    with urlopen(url, timeout=30) as response:
        raw = response.read()
    path.write_bytes(raw)
    manifest_path.write_text(json.dumps({"url": url, "retrieved_at": datetime.now(timezone.utc).isoformat(),
                                         "sha256": digest(raw), "bytes": len(raw),
                                         "authentication": "HTTPS retrieval only; no provider signature",
                                         "historical_available_at": "unknown"}, indent=2) + "\n")
    return raw


def load_prices():
    prices, manifest = [], []
    for month in ("11", "12"):
        path = ROOT.parent / "adapter" / "data" / f"BTCUSDT-4h-2024-{month}.csv"
        raw = path.read_bytes()
        manifest.append({"path": str(path.relative_to(ROOT.parent)), "sha256": digest(raw)})
        for row in csv.reader(io.StringIO(raw.decode())):
            prices.append((int(row[6]) // 1000 + 1, int(Decimal(row[4]) * 100000000)))
    return prices, manifest


def make_feature(name, value, event_at, lag):
    return Feature(name, value, event_at, event_at + lag, FEATURES[name][3])


def main():
    DATA.mkdir(exist_ok=True)
    fear = json.loads(download("fear-greed.json", "https://api.alternative.me/fng/?limit=0&format=json"))
    funding_zip = download("BTCUSDT-fundingRate-2024-12.zip",
        "https://data.binance.vision/data/futures/um/monthly/fundingRate/BTCUSDT/BTCUSDT-fundingRate-2024-12.zip")
    with ZipFile(io.BytesIO(funding_zip)) as archive:
        funding = list(csv.DictReader(io.StringIO(archive.read(archive.namelist()[0]).decode())))
    funding = sorted([(int(r["calc_time"]) // 1000, Decimal(r["last_funding_rate"])) for r in funding])
    fear = sorted([(int(r["timestamp"]), int(r["value"])) for r in fear["data"]])
    prices, price_manifest = load_prices()
    records = []
    for i in range(180, len(prices)):
        end, close = prices[i]
        cutoff = end + 3600  # decisions one hour AFTER closed bar
        trend = (close - prices[i - 180][1]) * 10000 // prices[i - 180][1]
        ret = (close - prices[i - 6][1]) * 10000 // prices[i - 6][1]
        common = [make_feature("trend_30d_bps", trend, end, 60), make_feature("return_1d_bps", ret, end, 60)]
        known_funding = [(t, v) for t, v in funding if t + 300 <= cutoff]
        fr = []
        if known_funding:
            last = known_funding[-1][0]
            window = [(t, v) for t, v in known_funding if last - DAY < t <= last]
            # 1ms provider timestamps normalized to seconds. Require three 8h events.
            if len(window) == 3 and window[-1][0] - window[0][0] == 16 * 3600:
                value = int((sum(v for _, v in window) * 1000000).to_integral_value(rounding="ROUND_FLOOR"))
                fr = [make_feature("funding_24h_ppm", value, last, 300)]
        known_fear = [(t, v) for t, v in fear if t + DAY <= cutoff]
        fg = [make_feature("fear_greed", known_fear[-1][1], known_fear[-1][0], DAY)] if known_fear else []
        for strategy, extra in (("funding_trend", fr), ("fear_rebound", fg)):
            records.append({"strategy": strategy, "cutoff": cutoff,
                            "inputs": [r.__dict__ for r in common + extra],
                            "decision": decide(strategy, common + extra, cutoff)})
    summary = {}
    for strategy in ("funding_trend", "fear_rebound"):
        subset = [r for r in records if r["strategy"] == strategy]
        summary[strategy] = {"decisions": len(subset),
            "positive_target_epochs": sum(any(v > 0 for v in (r["decision"]["targets_bps"] or {}).values()) for r in subset),
            "flat_target_epochs": sum(r["decision"]["status"] == "TARGET" and not any(r["decision"]["targets_bps"].values()) for r in subset),
            "data_blocked_epochs": sum(r["decision"]["status"] == "DATA_BLOCKED" for r in subset)}
    examples = [{"strategy": name, "cutoff": CUTOFF, "evidence": "SYNTHETIC CONTRACT FIXTURE, NOT REAL CUSTOM DATA",
                 "inputs": [r.__dict__ for r in fixture(name)], "decision": decide(name, fixture(name), CUTOFF)} for name in REQUIRED]
    report = {"scope": "HOST SIGNAL KERNEL ONLY; NO PNL, FILLS, PROOF OR UPLOAD",
        "historical_timing": "EX-POST archive: assumed price lag 60s, funding lag 300s, fear lag 24h. Not verified historical availability.",
        "strategy_sha256": digest((ROOT / "strategies.py").read_bytes()),
        "price_inputs": price_manifest, "archival_replay": summary,
        "synthetic_examples": examples}
    (ROOT / "results.json").write_text(json.dumps(report, indent=2) + "\n")
    (DATA / "archival-decisions.json").write_text(json.dumps(records, indent=2) + "\n")
    (DATA / "custom-input.example.json").write_text(json.dumps(examples[3], indent=2) + "\n")
    print(json.dumps({"archival_replay": summary, "synthetic_strategies": len(examples)}, indent=2))


if __name__ == "__main__":
    main()
