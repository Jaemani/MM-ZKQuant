import unittest
from dataclasses import replace
from strategies import DAY, FEATURES, REQUIRED, Feature, asof, decide

CUTOFF = 1800000000
POSITIVE = {
    "trend_30d_bps": 1200, "return_1d_bps": 150, "funding_24h_ppm": 200,
    "fear_greed": 20, "stable_supply_7d_bps": 70, "stable_depeg_bps": 10,
    "exchange_netflow_z_milli": -2000, "flow_coverage_bps": 9500,
    "unlock_7d_float_bps": 30, "news_score_milli": 500, "news_count": 8,
    "carry_forecast_72h_bps": 60, "carry_allin_cost_72h_bps": 20,
    "basis_abs_bps": 20, "margin_buffer_bps": 4000,
}


def fixture(strategy):
    return [Feature(n, POSITIVE[n], CUTOFF - 60, CUTOFF - 30, FEATURES[n][3],
                    asset="SOL" if strategy == "unlock_guard" else "BTC") for n in REQUIRED[strategy]]


class ContractTests(unittest.TestCase):
    def test_all_entry_and_missing_data(self):
        for name in REQUIRED:
            with self.subTest(name=name):
                rows = fixture(name)
                targets = decide(name, rows, CUTOFF)["targets_bps"]
                self.assertTrue(any(v > 0 for v in targets.values()))
                self.assertLessEqual(sum(abs(v) for v in targets.values()), 5000)
                self.assertEqual(decide(name, rows[1:], CUTOFF)["status"], "DATA_BLOCKED")

    def test_exit_each_strategy(self):
        negative = {"funding_trend": ("funding_24h_ppm", 301), "fear_rebound": ("fear_greed", 26),
                    "stable_liquidity": ("stable_depeg_bps", 51), "exchange_outflow": ("flow_coverage_bps", 8999),
                    "unlock_guard": ("unlock_7d_float_bps", 100), "frozen_news": ("news_count", 4),
                    "funding_carry": ("margin_buffer_bps", 2999)}
        for name, (feature, value) in negative.items():
            rows = [replace(r, value=value) if r.name == feature else r for r in fixture(name)]
            self.assertTrue(all(v == 0 for v in decide(name, rows, CUTOFF)["targets_bps"].values()))

    def test_point_in_time_revision(self):
        old = fixture("funding_trend")[1]
        future = replace(old, value=900, available_at=CUTOFF + 1, revision=1)
        self.assertEqual(asof([future, old], old.name, CUTOFF), old.value)
        self.assertEqual(asof([future, old], old.name, CUTOFF + 1), 900)

    def test_stale_missing_duplicate_source_and_numeric_contract(self):
        rows = fixture("funding_trend")
        bad = [replace(rows[0], event_at=CUTOFF-DAY-1), replace(rows[0], source="creator-unapproved"),
               replace(rows[0], asset="ETH"),
               replace(rows[0], value=True), replace(rows[0], value=1.5), replace(rows[0], value=-10001),
               replace(rows[0], available_at=rows[0].event_at-1), replace(rows[0], available_at=CUTOFF+1)]
        for row in bad:
            self.assertEqual(decide("funding_trend", [row, rows[1]], CUTOFF)["status"], "DATA_BLOCKED")
        self.assertEqual(decide("funding_trend", rows + rows, CUTOFF)["status"], "DATA_BLOCKED")

    def test_order_invariance_and_carry_hedge(self):
        for name in REQUIRED:
            rows = fixture(name)
            self.assertEqual(decide(name, rows, CUTOFF), decide(name, list(reversed(rows)), CUTOFF))
        self.assertEqual(sum(decide("funding_carry", fixture("funding_carry"), CUTOFF)["targets_bps"].values()), 0)

    def test_bounds(self):
        with self.assertRaises(ValueError):
            decide("funding_trend", fixture("funding_trend") * 257, CUTOFF)


if __name__ == "__main__":
    unittest.main()
