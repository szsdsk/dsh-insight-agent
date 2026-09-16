from __future__ import annotations

import csv
import sqlite3
from pathlib import Path

import pytest


@pytest.fixture
def workspace(tmp_path: Path) -> Path:
    csv_path = tmp_path / "sales.csv"
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["region", "amount", "sold_at", "note"])
        writer.writerow(["East", "10.50", "2025-01-01", "ok"])
        writer.writerow(["West", "20.00", "2025-01-02", ""])
        writer.writerow(["East", "11.50", "2025-01-03", "ok"])

    sqlite_path = tmp_path / "shop.sqlite"
    connection = sqlite3.connect(sqlite_path)
    connection.executescript(
        """
        CREATE TABLE customers(id INTEGER PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE orders(id INTEGER PRIMARY KEY, customer_id INTEGER, amount REAL, ordered_at TEXT);
        INSERT INTO customers VALUES (1, 'Ada'), (2, 'Lin');
        INSERT INTO orders VALUES
          (1, 1, 12.5, '2025-01-01'),
          (2, 1, NULL, '2025-01-02'),
          (3, 2, 20.0, '2025-02-01');
        """
    )
    connection.commit()
    connection.close()
    return tmp_path
