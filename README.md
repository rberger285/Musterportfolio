# Model portfolio dashboard

Static site (GitHub Pages). Prices are refreshed every weekday evening by `.github/workflows/update.yml`.

- `data/portfolio.json`: instruments, trades, start prices, benchmark, fictitious costs, change log. **Edit this file when the model portfolio changes** (add a Buy/Sell pair and a line in `changes`).
- `data/prices.json`, `data/distributions.json`, `data/updated.json`: written by `scripts/update_prices.py`. Don't edit them by hand.
- `impressum.html`: fill in the GmbH details before going public.

Local preview: `python -m http.server 8000` in this folder, then open http://localhost:8000
