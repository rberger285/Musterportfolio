"""Fetch end-of-day closes and distributions from Yahoo Finance for the model portfolio.

Writes data/prices.json ({id: {date: close}}) and data/distributions.json ({id: [[ex_date, amount], ...]}).
Run daily by .github/workflows/update.yml; can also be run locally: python scripts/update_prices.py
"""
import datetime as dt
import json
import pathlib
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CFG = json.loads((DATA / "portfolio.json").read_text(encoding="utf-8"))
START = int(dt.datetime(2025, 12, 31, tzinfo=dt.timezone.utc).timestamp())


def fetch(symbol):
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
           f"?period1={START}&period2={int(time.time()) + 86400}&interval=1d&events=div")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                res = json.load(r)["chart"]["result"][0]
            break
        except Exception:
            if attempt == 2:
                raise
            time.sleep(5)
    tz = res["meta"].get("gmtoffset", 0)
    closes, opens = {}, {}
    q = res["indicators"]["quote"][0]
    for t, c, o in zip(res.get("timestamp") or [], q["close"], q.get("open") or q["close"]):
        d = dt.datetime.utcfromtimestamp(t + tz).date().isoformat()
        if c is not None:
            closes[d] = round(c, 4)
        if o is not None:
            opens[d] = round(o, 4)
    divs = sorted((dt.datetime.utcfromtimestamp(v["date"] + tz).date().isoformat(), v["amount"])
                  for v in (res.get("events", {}).get("dividends", {}) or {}).values())
    return closes, opens, divs


def main():
    symbols = {i["id"]: (i["yahoo"], i["dist"]) for i in CFG["instruments"]}
    for leg in ("equity", "bonds"):
        b = CFG["benchmark"][leg]
        symbols[b["id"]] = (b["yahoo"], False)
    prices, dists, opens = {}, {}, {}
    for iid, (sym, is_dist) in symbols.items():
        closes, opn, divs = fetch(sym)
        prices[iid] = closes
        opens[iid] = opn
        if is_dist:
            dists[iid] = [[d, a] for d, a in divs]
        print(f"{iid:5} {sym:9} {len(closes):4} closes, last {max(closes) if closes else '-'}")
    (DATA / "prices.json").write_text(json.dumps(prices, separators=(",", ":")), encoding="utf-8")
    (DATA / "distributions.json").write_text(json.dumps(dists, indent=1), encoding="utf-8")
    # Trades booked with an estimated price get the Xetra opening price of the trade date once it exists.
    filled = 0
    for t in CFG["transactions"]:
        if t.get("estimated") and t["date"] in opens.get(t["id"], {}):
            t["price"] = opens[t["id"]][t["date"]]
            t["estimated"] = False
            filled += 1
    if filled:
        (DATA / "portfolio.json").write_text(json.dumps(CFG, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"filled {filled} execution price(s) with the opening price")
    (DATA / "updated.json").write_text(json.dumps({"updated": dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%MZ")}), encoding="utf-8")


if __name__ == "__main__":
    main()
