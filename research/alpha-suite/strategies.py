"""Host reference kernels; integer units, no I/O, no orders, no ZK proof.

All inputs are normalized FEATURES, not raw oracle data. Their computation and
provenance need a separately committed/verified adapter in production.
"""
from dataclasses import dataclass

DAY = 86400


@dataclass(frozen=True)
class Feature:
    name: str
    value: int
    event_at: int
    available_at: int
    source: str
    revision: int = 0
    asset: str = "BTC"


# name: (maximum age seconds, minimum value, maximum value, allowed source)
FEATURES = {
    "trend_30d_bps": (DAY, -10000, 100000, "canonical-price-v1"),
    "return_1d_bps": (DAY, -10000, 100000, "canonical-price-v1"),
    "funding_24h_ppm": (12 * 3600, -100000, 100000, "binance-funding-v1"),
    "fear_greed": (36 * 3600, 0, 100, "alternative-me-v1"),
    "stable_supply_7d_bps": (2 * DAY, -10000, 100000, "stable-supply-v1"),
    "stable_depeg_bps": (3600, 0, 10000, "canonical-price-v1"),
    "exchange_netflow_z_milli": (DAY, -10000, 10000, "custom-flow-v1"),
    "flow_coverage_bps": (DAY, 0, 10000, "custom-flow-v1"),
    "unlock_7d_float_bps": (DAY, 0, 100000, "custom-unlock-v1"),
    "news_score_milli": (6 * 3600, -1000, 1000, "custom-news-v1"),
    "news_count": (6 * 3600, 0, 100000, "custom-news-v1"),
    "carry_forecast_72h_bps": (3600, -10000, 10000, "custom-carry-v1"),
    "carry_allin_cost_72h_bps": (3600, 0, 10000, "custom-carry-v1"),
    "basis_abs_bps": (3600, 0, 10000, "canonical-price-v1"),
    "margin_buffer_bps": (300, 0, 10000, "canonical-account-v1"),
}

REQUIRED = {
    "funding_trend": ("trend_30d_bps", "funding_24h_ppm"),
    "fear_rebound": ("fear_greed", "return_1d_bps", "trend_30d_bps"),
    "stable_liquidity": ("stable_supply_7d_bps", "stable_depeg_bps", "trend_30d_bps"),
    "exchange_outflow": ("exchange_netflow_z_milli", "flow_coverage_bps", "trend_30d_bps"),
    "unlock_guard": ("unlock_7d_float_bps", "trend_30d_bps"),
    "frozen_news": ("news_score_milli", "news_count", "return_1d_bps"),
    "funding_carry": ("carry_forecast_72h_bps", "carry_allin_cost_72h_bps", "basis_abs_bps", "margin_buffer_bps"),
}


def asof(rows, name, cutoff, asset="BTC"):
    """Reject ambiguity and invalid timestamps. Revisions are selected AS OF cutoff.

    available_at must be independently observed/attested in production. This
    routine cannot establish its truth from creator-supplied integers.
    """
    age, lower, upper, source = FEATURES[name]
    candidates = []
    keys = set()
    for row in rows:
        if row.name != name:
            continue
        if (any(type(x) is not int for x in (row.value, row.event_at, row.available_at, row.revision))
                or not lower <= row.value <= upper or row.source != source or row.asset != asset
                or row.event_at < 0 or row.available_at < row.event_at or row.revision < 0):
            raise ValueError(f"invalid feature: {name}")
        key = (row.event_at, row.available_at, row.revision)
        if key in keys:
            raise ValueError(f"duplicate feature: {name}")
        keys.add(key)
        if row.available_at <= cutoff:
            candidates.append(row)
    if not candidates:
        raise ValueError(f"unavailable feature: {name}")
    latest = max(candidates, key=lambda r: (r.event_at, r.available_at, r.revision))
    if cutoff - latest.event_at > age:
        raise ValueError(f"stale feature: {name}")
    return latest.value


def decide(strategy, rows, cutoff):
    """Return desired NAV exposures in bps; targets are not order sizes or fills.

    No retained signal state: neutral signal explicitly requests zero exposure.
    Invalid data requests NO new target; executor must apply registered outage
    policy to actual positions (including hedges), never invent a flat fill.
    """
    if strategy not in REQUIRED or type(cutoff) is not int or cutoff < 0:
        raise ValueError("unknown strategy or invalid cutoff")
    if len(rows) > 512:
        raise ValueError("snapshot exceeds 512 feature rows")
    try:
        asset = "SOL" if strategy == "unlock_guard" else "BTC"
        x = {name: asof(rows, name, cutoff, asset) for name in REQUIRED[strategy]}
    except ValueError as error:
        return {"status": "DATA_BLOCKED", "targets_bps": None, "reason": str(error)}
    weight = 0
    if strategy == "funding_trend":
        weight = 5000 if x["trend_30d_bps"] > 0 and x["funding_24h_ppm"] <= 300 else 0
    elif strategy == "fear_rebound":
        weight = 2500 if x["fear_greed"] <= 25 and x["return_1d_bps"] >= 100 and x["trend_30d_bps"] >= -1500 else 0
    elif strategy == "stable_liquidity":
        weight = 5000 if x["stable_supply_7d_bps"] >= 50 and x["stable_depeg_bps"] <= 50 and x["trend_30d_bps"] > 0 else 0
    elif strategy == "exchange_outflow":
        weight = 3500 if x["exchange_netflow_z_milli"] <= -1500 and x["flow_coverage_bps"] >= 9000 and x["trend_30d_bps"] > 0 else 0
    elif strategy == "unlock_guard":
        weight = 2500 if x["unlock_7d_float_bps"] < 100 and x["trend_30d_bps"] > 0 else 0
    elif strategy == "frozen_news":
        weight = 2000 if x["news_score_milli"] >= 350 and x["news_count"] >= 5 and -500 <= x["return_1d_bps"] <= 800 else 0
    elif strategy == "funding_carry":
        weight = 2500 if (x["carry_forecast_72h_bps"] - x["carry_allin_cost_72h_bps"] >= 15
                          and x["basis_abs_bps"] <= 50 and x["margin_buffer_bps"] >= 3000) else 0
        return {"status": "TARGET", "targets_bps": {"BTC_SPOT": weight, "BTC_PERP": -weight},
                "reason": "carry margin and cost gate"}
    instrument = "SOL_SPOT" if strategy == "unlock_guard" else "BTC_SPOT"
    return {"status": "TARGET", "targets_bps": {instrument: weight}, "reason": "entry gate" if weight else "exit/flat gate"}
