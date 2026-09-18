"""Evaluate an explicit JSON snapshot. No live network access or order submission."""
import argparse
import json
from pathlib import Path
from strategies import Feature, decide

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("snapshot", type=Path)
    args = parser.parse_args()
    snapshot = json.loads(args.snapshot.read_text())
    result = decide(snapshot["strategy"], [Feature(**r) for r in snapshot["inputs"]], snapshot["cutoff"])
    print(json.dumps(result, indent=2))
