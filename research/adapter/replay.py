#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Bounded adapter experiment; NOT a full Freqtrade backtest or a zkVM proof.

Executes original public method bodies with pandas/TA-Lib. Framework parameter
and class wiring is replaced explicitly. Compares their indicator/signal output
to streaming integer logic with defined seeding/rounding. No strategy P&L is
computed. Source licenses and commits are in sources/ and sources-manifest.json.
"""
from __future__ import annotations

import ast
import csv
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import platform
import sys
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / ".deps"))  # Optional isolated TA-Lib wheel.
import numpy as np
import pandas as pd
import talib
import talib.abstract as ta

SCALE = 10**8
MAX_VALUE = 10**12 * SCALE
SPEC = {
    "artifact_kind": "reference integer transition specification, not compiled zk guest",
    "scale": SCALE, "rounding": "floor after each integer division",
    "inputs": "closed UTC candles, strictly contiguous fixed interval; close > 0, volume >= 0",
    "bounds": "close and volume <= 10^12; state arithmetic checked against signed 128-bit",
    "average": {"ema_periods": [8, 21], "seed": "SMA of first period observations", "zero_volume": "update indicators but suppress entry/exit"},
    "trend": {"ema_period": 20, "seed": "first close (pandas adjust=False semantics)", "obv_seed": "first volume"},
    "excluded": ["orders", "fills", "ROI", "stoploss", "trailing stop", "position sizing", "leverage", "exchange", "fees", "framework lifecycle"],
}


def extract_functions(path, names, class_name=None, namespace=None):
    tree = ast.parse(path.read_text())
    pool = tree.body if class_name is None else next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == class_name).body
    body = [n for n in pool if isinstance(n, ast.FunctionDef) and n.name in names]
    assert len(body) == len(names)
    env = {} if namespace is None else dict(namespace)
    exec(compile(ast.Module(body=body, type_ignores=[]), str(path), "exec"), env)
    return {name: env[name] for name in names}


def originals():
    funcs = extract_functions(ROOT / "sources/freqtrade/technical/technical/vendor/qtpylib/indicators.py", ["crossed", "crossed_above"], namespace={"np": np, "pd": pd})
    common = {"DataFrame": pd.DataFrame, "ta": ta, "qtpylib": SimpleNamespace(**funcs)}
    result = {}
    samples = [("average", "berlinguyinca/AverageStrategy.py", "AverageStrategy"), ("trend", "futures/TrendFollowingStrategy.py", "TrendFollowingStrategy")]
    names = ["populate_indicators", "populate_entry_trend", "populate_exit_trend"]
    for key, file, cls in samples:
        path = ROOT / "sources/freqtrade/freqtrade-strategies/user_data/strategies" / file
        result[key] = type("Extracted" + cls, (), extract_functions(path, names, cls, common))()
    result["average"].buy_range_short = SimpleNamespace(value=8, range=[8])
    result["average"].buy_range_long = SimpleNamespace(value=21, range=[21])
    return result


def checked(x):
    if not -(2**127) <= x < 2**127:
        raise ValueError("128-bit state arithmetic overflow")
    return x


def quantize(value, positive=False):
    d = Decimal(str(value))
    if not d.is_finite():
        raise ValueError("non-finite input")
    x = d * SCALE
    if x != int(x):
        raise ValueError("input exceeds canonical precision")
    n = int(x)
    if n < (1 if positive else 0) or n > MAX_VALUE:
        raise ValueError("input outside canonical bounds")
    return n


def integer_stream(rows, kind, interval_ms):
    signals, indicators = [], []
    prior_time = prior_close = prior_ema = prior_obv = None
    fast = slow = None
    initial = []
    obv = 0
    for row in rows:
        t = int(row["open_time"])
        if prior_time is not None and t != prior_time + interval_ms:
            raise ValueError("non-contiguous candle schedule")
        prior_time = t
        price = quantize(row["close"], positive=True)
        volume = quantize(row["volume"])
        if kind == "average":
            old_fast, old_slow = fast, slow
            if len(initial) < 21:
                initial.append(price)
            if fast is None:
                if len(initial) == 8:
                    fast = checked(sum(initial)) // 8
            else:
                fast = checked(7 * fast + 2 * price) // 9
            if slow is None:
                if len(initial) == 21:
                    slow = checked(sum(initial)) // 21
            else:
                slow = checked(20 * slow + 2 * price) // 22
            ready = None not in (fast, slow, old_fast, old_slow)
            enter = ready and fast > slow and old_fast <= old_slow and volume > 0
            leave = ready and slow > fast and old_slow <= old_fast and volume > 0
            signals.append([int(enter), int(leave)])
            indicators.append([None if fast is None else fast / SCALE, None if slow is None else slow / SCALE])
        else:
            ema = price if prior_ema is None else checked(19 * prior_ema + 2 * price) // 21
            obv = volume if prior_close is None else checked(obv + (volume if price > prior_close else -volume if price < prior_close else 0))
            up = prior_close is not None and price > ema and prior_close <= prior_ema
            down = prior_close is not None and price < ema and prior_close >= prior_ema
            obv_up = prior_obv is not None and obv > prior_obv
            obv_down = prior_obv is not None and obv < prior_obv
            signals.append([int(up and obv_up), int(down and obv_down), int(down and obv_up), int(up and obv_down)])
            indicators.append([ema / SCALE, obv / SCALE])
            prior_close, prior_ema, prior_obv = price, ema, obv
    return np.asarray(signals), indicators


def original_stream(rows, original, kind):
    frame = pd.DataFrame(rows)
    for col in ["open", "high", "low", "close", "volume"]:
        frame[col] = frame[col].astype(float)
    frame = original.populate_indicators(frame, {})
    frame = original.populate_entry_trend(frame, {})
    frame = original.populate_exit_trend(frame, {})
    cols = ["enter_long", "exit_long"] if kind == "average" else ["enter_long", "enter_short", "exit_long", "exit_short"]
    inds = ["ema8", "ema21"] if kind == "average" else ["trend", "obv"]
    return frame[cols].fillna(0).astype(int).to_numpy(), frame[inds].to_numpy()


def compare(rows, kind, interval_ms, original, label):
    ref, ref_inds = original_stream(rows, original, kind)
    port, port_inds = integer_stream(rows, kind, interval_ms)
    bad = np.where(np.any(ref != port, axis=1))[0].tolist()
    errors = []
    for col in range(2):
        diffs = [abs(float(r[col]) - float(p[col])) for r, p in zip(ref_inds, port_inds) if p[col] is not None and np.isfinite(r[col])]
        errors.append(max(diffs, default=0))
    return {
        "label": label, "kernel": kind, "bars": len(rows),
        "signal_columns": ["enter_long", "exit_long"] if kind == "average" else ["enter_long", "enter_short", "exit_long", "exit_short"],
        "reference_signal_counts": ref.sum(axis=0).tolist(), "port_signal_counts": port.sum(axis=0).tolist(),
        "mismatch_bars": len(bad), "mismatch_flags": int(np.sum(ref != port)),
        "maximum_indicator_absolute_error": errors,
        "first_mismatches": [{"index": i, "open_time": rows[i]["open_time"], "close": rows[i]["close"], "reference": ref[i].tolist(), "port": port[i].tolist(), "reference_indicators": ref_inds[i].tolist(), "port_indicators": port_inds[i]} for i in bad[:10]],
    }


def synthetic(prices, volumes=None, interval_ms=14400000):
    if volumes is None:
        volumes = ["1"] * len(prices)
    return [{"open_time": str(1704067200000 + i * interval_ms), "open": str(p), "high": str(p), "low": str(p), "close": str(p), "volume": str(v)} for i, (p, v) in enumerate(zip(prices, volumes))]


def main():
    manifest = json.loads((ROOT / "data/manifest.json").read_text())
    for src in json.loads((ROOT / "sources-manifest.json").read_text()):
        p = ROOT / "sources" / src["repo"] / src["path"]
        assert hashlib.sha256(p.read_bytes()).hexdigest() == src["sha256"]
    original = originals()
    datasets = {"average": [], "trend": []}
    for source in manifest["sources"]:
        raw = (ROOT / "data" / source["filename"]).read_bytes()
        assert hashlib.sha256(raw).hexdigest() == source["csv_sha256"]
        kind = "average" if "-4h-" in source["filename"] else "trend"
        datasets[kind].extend(csv.DictReader(raw.decode().splitlines(), fieldnames=manifest["columns"]))
    results = []
    for kind, rows in datasets.items():
        rows.sort(key=lambda x: int(x["open_time"]))
        interval = 14400000 if kind == "average" else 300000
        results.append(compare(rows, kind, interval, original[kind], "BTCUSDT 2024 4h" if kind == "average" else "BTCUSDT 2024-01 5m"))
    patterns = {
        "constant_then_one_tick": ["100.00000000"] * 30 + ["100.00000001"] * 5 + ["100.00000000"] * 5,
        "monotonic_up": list(range(1, 81)),
        "zero_volume_reversal": list(range(30, 0, -1)) + list(range(1, 51)),
        "minimum_price": ["0.00000001"] * 30 + ["0.00000002"] * 10 + ["0.00000001"] * 10,
    }
    for label, prices in patterns.items():
        rows = synthetic(prices, [0] * len(prices) if label == "zero_volume_reversal" else None)
        for kind in original:
            results.append(compare(rows, kind, 14400000, original[kind], label))
    rejections = []
    for label in ["missing_bar", "duplicate_bar", "nan_price", "excess_precision", "negative_volume"]:
        rows = synthetic(list(range(1, 31)))
        if label == "missing_bar": rows.pop(12)
        if label == "duplicate_bar": rows.insert(12, dict(rows[12]))
        if label == "nan_price": rows[12]["close"] = "nan"
        if label == "excess_precision": rows[12]["close"] = "1.000000001"
        if label == "negative_volume": rows[12]["volume"] = "-1"
        try:
            integer_stream(rows, "average", 14400000)
            raise AssertionError("Invalid input unexpectedly accepted")
        except ValueError as exc:
            rejections.append({"case": label, "result": "rejected", "reason": str(exc)})
    doc = {
        "environment": {"python": platform.python_version(), "numpy": np.__version__, "pandas": pd.__version__, "ta_lib_python": talib.__version__, "ta_lib_core": talib.__ta_version__.decode()},
        "scope": {"complete_strategy_replays": 0, "public_strategy_signal_kernels": 2, "unmodified_strategy_method_bodies": 6, "unmodified_helper_function_bodies": 2, "zk_proofs": 0, "actual_fills": 0},
        "spec": SPEC, "spec_sha256": hashlib.sha256(json.dumps(SPEC, sort_keys=True).encode()).hexdigest(),
        "replays": results, "input_rejections": rejections,
    }
    (ROOT / "results.json").write_text(json.dumps(doc, indent=2, allow_nan=False) + "\n")
    print(json.dumps({"scope": doc["scope"], "replays": [{k: r[k] for k in ["label", "kernel", "bars", "reference_signal_counts", "port_signal_counts", "mismatch_bars", "mismatch_flags"]} for r in results], "input_rejections": rejections}, indent=2))


if __name__ == "__main__":
    main()
