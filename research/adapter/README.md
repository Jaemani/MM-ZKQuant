# Adapter experiment — scope and reproduction

This exercise checks **two public Freqtrade indicator/signal kernels**, not two complete trading systems. It executes six original method bodies and two original qtpylib helper bodies, extracted with Python AST from commit-pinned source files. Pandas and TA-Lib are real libraries; IStrategy, parameter configuration, exchange adapters, order lifecycle, portfolio accounting, fills, ROI, stoploss and trailing-stop behavior are not executed. No zkVM guest was compiled, no proof was produced, and no actual order was submitted.

`replay.py` compares those outputs to a Python implementation of a proposed bounded integer transition specification. **This is not itself a proof-compatible compiled artifact.** The arithmetic can be specified for a small Rust/DSL implementation, which still needs its own guest build, proving benchmark, numeric bounds and circuit/VM review. The Python port uses signed 128-bit bounds checks, scale 1e8, floor rounding, explicit EMA initialization, and contiguous closed-candle inputs. Its rounding differs from the original floating-point environment.

Historical data: Binance public archive, BTCUSDT 4h, all 12 months of 2024 (2,196 candles) for AverageStrategy's native interval; BTCUSDT 5m, January 2024 (8,928 candles) for TrendFollowingStrategy's native interval. Download provenance and SHA-256 hashes are recorded in `data/manifest.json`. This archive is an experiment input, **not a production authenticated market-data oracle**. Manifests pin retrieved bytes; their hashes do not independently prove exchange completeness or absence of later corrections.

Reproduce from the repository root with Python 3.12 (the observed run used 3.12.14 on macOS arm64):

```bash
rtk proxy python3 -m venv research/adapter/.venv
rtk proxy research/adapter/.venv/bin/python -m pip install -r research/adapter/requirements.txt
rtk proxy research/adapter/.venv/bin/python research/adapter/replay.py
```

The source and CSV snapshots are already included. To restore them independently, run:

```bash
rtk proxy python3 research/adapter/fetch.py
```

Observed environment: Python 3.12.14, numpy 2.3.5, pandas 2.2.3, TA-Lib Python 0.6.8 / C 0.6.4. A supported TA-Lib wheel or local native build is required; package version alone does not fix platform floating-point behavior. `results.json` records the exact observed environment, scope, counts, indicator errors, mismatch examples, input rejections, and the specification hash. The optional `.deps` path is an isolated local wheel target used during this run and is ignored by Git.

Results: 0 differing signal bars on both historical samples. **Counterexamples exist:** a valid 40-bar constant-price/one-1e-8-tick fixture produces two differing decisions for AverageStrategy and one for TrendFollowingStrategy. The fixture respects the candidate 1e-8 numeric input grid; it is an adversarial arithmetic case, not a claim that BTCUSDT trades on that tick grid. Historical matching is therefore neither general equivalence nor exact numeric equivalence. Full strategy equivalence, execution equivalence, profitability, alpha and proving cost remain untested.

Files under `sources/` retain their original headers and repository licenses (Freqtrade repositories GPL; Hummingbot and LEAN Apache 2.0; qtpylib's retained header states its own terms). These are educational/public samples, not a representative survey of profitable proprietary strategies. `replay.py` is GPL-3.0-only because it includes adaptations of the Freqtrade example logic.
