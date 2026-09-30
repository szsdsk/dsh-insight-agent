"""Materialize and verify the frozen 30-case office diagnostic benchmark."""

from __future__ import annotations

import argparse
import csv
from decimal import Decimal
import hashlib
import io
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "evals" / "data" / "office"
MANIFEST = ROOT / "evals" / "manifests" / "office-frozen-30.json"

DOMAINS = {
    "expense": {"entity": "Department", "detail": "Project", "before": "Amount", "after": "Cost", "key": "Document"},
    "purchase": {"entity": "Supplier", "detail": "Category", "before": "Amount", "after": "Spend", "key": "PurchaseOrder"},
    "inventory": {"entity": "Warehouse", "detail": "SKU", "before": "Quantity", "after": "OnHand", "key": "Batch"},
}
BASE = [
    ("A", "P1", "10", "k1"), ("A", "P2", "20", "k2"), ("B", "P1", "5", "k3"),
    ("B", "P2", "0", "k4"), ("C", "P3", "8", "k5"), ("", "P3", "2", "k6"),
    ("B", "P1", "5", "k3"),
]
CURRENT = [
    ("A", "P1", "13", "k1"), ("A", "P2", "15", "k2"), ("B", "P1", "9", "k3"),
    ("B", "P2", "4", "k4"), ("D", "P4", "11", "k7"), ("", "P3", "2", "k6"),
    ("B", "P1", "9", "k3"),
]
CURRENT_V2 = [
    ("A", "P1", "17", "k1"), ("A", "P2", "19", "k2"), ("B", "P1", "6", "k3"),
    ("B", "P2", "3", "k4"), ("E", "P5", "14", "k8"), ("", "P3", "2", "k6"),
]


def csv_bytes(config: dict[str, str], rows: list[tuple[str, str, str, str]], period: str) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    measure_name = config["before"] if period == "baseline" else config["after"]
    if config["entity"] == "Supplier":
        writer.writerow([config["key"], config["entity"], config["detail"], measure_name, "Tax"])
        writer.writerows((key, entity, detail, value, str(Decimal(value) / 10))
                         for entity, detail, value, key in rows)
    elif config["entity"] == "Warehouse":
        writer.writerow([config["detail"], config["key"], measure_name, config["entity"], "Reserved"])
        writer.writerows((detail, key, value, entity, "1" if Decimal(value) > 0 else "0")
                         for entity, detail, value, key in rows)
    else:
        writer.writerow([config["entity"], config["detail"], measure_name, config["key"]])
        writer.writerows(rows)
    return output.getvalue().encode("utf-8")


def measure(rows: list[tuple[str, str, str, str]], aggregation: str) -> str:
    if aggregation == "sum":
        return str(sum((Decimal(row[2]) for row in rows), Decimal(0)))
    if aggregation == "avg":
        return str(sum((Decimal(row[2]) for row in rows), Decimal(0)) / len(rows)) if rows else "null"
    if aggregation == "count_distinct":
        return str(len({row[3] for row in rows}))
    return str(len(rows))


def expected(before: list[tuple[str, str, str, str]], after: list[tuple[str, str, str, str]], aggregation: str, dimensions: list[int]) -> dict[str, object]:
    groups = {}
    if dimensions:
        keys = {tuple(row[index] for index in dimensions) for row in before + after}
        for key in sorted(keys):
            first = [row for row in before if tuple(row[index] for index in dimensions) == key]
            second = [row for row in after if tuple(row[index] for index in dimensions) == key]
            groups["|".join(key)] = {"baseline": measure(first, aggregation), "current": measure(second, aggregation)}
    return {"baseline": measure(before, aggregation), "current": measure(after, aggregation), "groups": groups}


def quality(rows: list[tuple[str, str, str, str]]) -> dict[str, int]:
    return {"rows": len(rows), "missing_entity": sum(not row[0] for row in rows),
            "duplicate_rows": len(rows) - len(set(rows)),
            "duplicate_keys": len(rows) - len({row[3] for row in rows})}


def frozen_payload() -> tuple[dict[str, bytes], dict[str, object]]:
    files = {}
    cases = []
    index = 0
    for domain, config in DOMAINS.items():
        for period, rows in (("baseline", BASE), ("current", CURRENT), ("current-v2", CURRENT_V2)):
            files[f"{domain}-{period}.csv"] = csv_bytes(config, rows, period)
        intents = [
            ("quality", "Find missing values and duplicate rows and keys; compare physical row counts.", "count", []),
            ("quality", "Check whether the current file changed fields or has duplicate keys; compare physical row counts.", "count", []),
            ("metric", "Compare the sum of the measure across both periods, counting every physical row.", "sum", []),
            ("metric", "Compare the row counts across both periods.", "count", []),
            ("metric", "Compare the average measure across both periods.", "avg", []),
            ("drilldown", "Find which primary groups contributed most to the change in the sum of the measure.", "sum", [0]),
            ("drilldown", "Compare distinct business keys for each primary group.", "count_distinct", [0]),
            ("two-dimension", "Compare the sum of the measure by both primary and secondary groups.", "sum", [0, 1]),
            ("ambiguity", "Find the best group. Ask what best means before calculating.", "sum", []),
            ("rerun", "Reuse the confirmed sum of the measure with replacement current data and recheck compatibility.", "sum", [0]),
        ]
        for category, instruction, aggregation, dimension_indices in intents:
            index += 1
            after_rows = CURRENT_V2 if category == "rerun" else CURRENT
            cases.append({
                "id": f"office-{index:03d}", "domain": domain, "category": category,
                "question": f"{domain.capitalize()} table: {instruction}",
                "baseline": f"evals/data/office/{domain}-baseline.csv",
                "current": f"evals/data/office/{domain}-{'current-v2' if category == 'rerun' else 'current'}.csv",
                "mapping": [{"name": "measure", "baseline": config["before"], "current": config["after"]},
                            {"name": "primary", "baseline": config["entity"], "current": config["entity"]},
                            {"name": "secondary", "baseline": config["detail"], "current": config["detail"]},
                            {"name": "key", "baseline": config["key"], "current": config["key"]}],
                "metric": {"name": "measure", "aggregation": aggregation,
                           "field": "key" if aggregation == "count_distinct" else "measure" if aggregation in ("sum", "avg") else None},
                "dimensions": ["primary" if value == 0 else "secondary" for value in dimension_indices],
                "expected": expected(BASE, after_rows, aggregation, dimension_indices),
                "expected_quality": {"baseline": quality(BASE), "current": quality(after_rows)},
            })
    manifest = {"formatVersion": 1, "caseCount": 30,
                "files": {name: hashlib.sha256(content).hexdigest() for name, content in sorted(files.items())},
                "cases": cases}
    return files, manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    files, manifest = frozen_payload()
    encoded = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    if args.check:
        for name, content in files.items():
            if (DATA / name).read_bytes() != content:
                raise SystemExit(f"fixture changed: {name}")
        if MANIFEST.read_bytes() != encoded:
            raise SystemExit("frozen case manifest changed")
    else:
        DATA.mkdir(parents=True, exist_ok=True)
        for name, content in files.items():
            (DATA / name).write_bytes(content)
        MANIFEST.write_bytes(encoded)
    print("30 frozen office cases and data checksums verified" if args.check else "30 office cases prepared")


if __name__ == "__main__":
    main()
