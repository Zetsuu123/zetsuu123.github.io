#!/usr/bin/env python3
"""Fetch daily closes for the S&P 500 and Nasdaq 100 into markets/data/*.json.

Uses Yahoo Finance's public chart endpoint (no key). Run by
.github/workflows/markets-data.yml after each US trading day.
"""
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone

INDICES = {
    "spx": ("^GSPC", "S&P 500"),
    "ndx": ("^NDX", "Nasdaq 100"),
}
START = int(datetime(2000, 1, 1, tzinfo=timezone.utc).timestamp())
OUT = os.path.join(os.path.dirname(__file__), "..", "markets", "data")


def fetch(symbol):
    url = (
        "https://query1.finance.yahoo.com/v8/finance/chart/"
        + urllib.request.quote(symbol)
        + f"?period1={START}&period2={int(time.time()) + 86400}&interval=1d&events=history"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (markets-tracker)"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)["chart"]["result"][0]
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                raise
            print(f"{symbol}: {e}, retrying", file=sys.stderr)
            time.sleep(5 * (attempt + 1))


def main():
    os.makedirs(OUT, exist_ok=True)
    for key, (symbol, name) in INDICES.items():
        res = fetch(symbol)
        meta = res["meta"]
        tz_offset = meta.get("gmtoffset", -18000)
        closes = res["indicators"]["quote"][0]["close"]
        dates, values = [], []
        for ts, c in zip(res["timestamp"], closes):
            if c is None:
                continue
            d = datetime.fromtimestamp(ts + tz_offset, tz=timezone.utc).strftime("%Y-%m-%d")
            if dates and dates[-1] == d:
                values[-1] = round(c, 2)
                continue
            dates.append(d)
            values.append(round(c, 2))
        if len(dates) < 1000:
            sys.exit(f"{symbol}: only {len(dates)} rows, refusing to overwrite")
        payload = {
            "key": key,
            "symbol": symbol,
            "name": name,
            "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "dates": dates,
            "close": values,
        }
        with open(os.path.join(OUT, f"{key}.json"), "w") as f:
            json.dump(payload, f, separators=(",", ":"))
        print(f"{name}: {len(dates)} days, last {dates[-1]} = {values[-1]}")


if __name__ == "__main__":
    main()
