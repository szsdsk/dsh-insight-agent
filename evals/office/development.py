"""Prepare independent development inputs without modifying the frozen office suite."""

from __future__ import annotations

import argparse
import csv
from decimal import Decimal
import hashlib
import io
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "evals/data/office-dev"
MANIFEST = ROOT / "evals/manifests/office-development.json"
BASELINE = [("Ops", "20", "t1"), ("Engineering", "15", "t2"),
            ("Engineering", "30", "t3"), ("", "5", "t4"), ("Support", "10", "t5")]
CURRENT = [("Engineering", "20", "t2"), ("Engineering", "35", "t3"),
           ("Ops", "16", "t1"), ("Design", "14", "t6"), ("", "5", "t4")]


def encoded_csv(header: list[str], rows: list[tuple[str, str, str]]) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(header)
    writer.writerows(rows)
    return output.getvalue().encode("utf-8")


def total(rows: list[tuple[str, str, str]]) -> str:
    return str(sum((Decimal(row[1]) for row in rows), Decimal(0)))


def payload() -> tuple[dict[str, bytes], dict[str, object]]:
    files = {"expense-before.csv": encoded_csv(["Department", "Spend", "Ticket"], BASELINE),
             "expense-after.csv": encoded_csv(["Department", "Paid", "Ticket"], CURRENT)}
    groups = {name: {"baseline": total([row for row in BASELINE if row[0] == name]),
                     "current": total([row for row in CURRENT if row[0] == name])}
              for name in sorted({row[0] for row in BASELINE + CURRENT})}
    quality = {"rows": 5, "missing_entity": 1, "duplicate_rows": 0, "duplicate_keys": 0}
    case = {
        "id": "office-dev-001", "domain": "expense", "category": "drilldown",
        "question": "比较两期费用，按每条物理行求和（上期 Spend、本期 Paid），检查缺失和重复；Ticket 是唯一键。找出费用变化主要集中在哪些 Department，保留新增、消失和空部门，说明口径并生成证据报告。",
        "baseline": "evals/data/office-dev/expense-before.csv",
        "current": "evals/data/office-dev/expense-after.csv",
        "mapping": [{"name": "measure", "baseline": "Spend", "current": "Paid"},
                    {"name": "primary", "baseline": "Department", "current": "Department"},
                    {"name": "key", "baseline": "Ticket", "current": "Ticket"}],
        "metric": {"name": "measure", "aggregation": "sum", "field": "measure"},
        "dimensions": ["primary"],
        "expected": {"baseline": total(BASELINE), "current": total(CURRENT), "groups": groups},
        "expected_quality": {"baseline": quality, "current": quality},
    }
    return files, {"formatVersion": 1, "caseCount": 1,
                   "files": {name: hashlib.sha256(content).hexdigest() for name, content in sorted(files.items())},
                   "cases": [case]}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    files, manifest = payload()
    encoded = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    if args.check:
        for name, content in files.items():
            if (DATA / name).read_bytes() != content:
                raise SystemExit(f"development fixture changed: {name}")
        if MANIFEST.read_bytes() != encoded:
            raise SystemExit("development manifest changed; regenerate after reviewing oracle changes")
    else:
        DATA.mkdir(parents=True, exist_ok=True)
        for name, content in files.items():
            (DATA / name).write_bytes(content)
        MANIFEST.write_bytes(encoded)
    print("1 independent office development case verified" if args.check else "1 office development case prepared")


if __name__ == "__main__":
    main()
