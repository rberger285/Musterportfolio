// Musterportfolio dashboard: rebuilds the model portfolio from data/*.json on every page load.
(async function () {
  const get = (f) => fetch(f, { cache: "no-cache" }).then((r) => r.json());
  const [cfg, prices, dists, upd] = await Promise.all([
    get("data/portfolio.json"), get("data/prices.json"), get("data/distributions.json"),
    get("data/updated.json").catch(() => ({})),
  ]);

  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const pct = (x, d = 2) => (x == null || isNaN(x) ? "–" : (x >= 0 ? "+" : "−") + Math.abs(x * 100).toFixed(d).replace(".", ",") + " %");
  const pp = (x) => (x >= 0 ? "+" : "−") + Math.abs(x * 100).toFixed(2).replace(".", ",") + " %-Pkt.";
  const w1 = (x) => (x * 100).toFixed(1).replace(".", ",") + " %";
  const cls = (x) => (x >= 0 ? "pos" : "neg");
  const fmtD = (d) => d.slice(8, 10) + "." + d.slice(5, 7) + "." + d.slice(0, 4);
  const set = (id, html, c) => { const e = document.getElementById(id); e.innerHTML = html; if (c) e.className += " " + c; };

  // ---- price matrix (forward-filled), day 0 = inception with start prices
  const inc = cfg.inception;
  const bm = cfg.benchmark;
  const ids = cfg.instruments.map((i) => i.id).concat([bm.equity.id, bm.bonds.id]);
  const dateSet = new Set();
  ids.forEach((id) => Object.keys(prices[id] || {}).forEach((d) => d > inc && dateSet.add(d)));
  const dates = [inc].concat([...dateSet].sort());
  const px = {};
  ids.forEach((id) => {
    let last = cfg.startPrices[id];
    px[id] = dates.map((d, k) => (k === 0 ? last : (last = (prices[id] || {})[d] ?? last)));
  });

  // ---- positions, cash, NAV
  const tx = cfg.transactions;
  const sharesAt = (id, d, strict) => tx.reduce((s, t) => {
    if (t.id !== id || (strict ? t.date >= d : t.date > d)) return s;
    return s + (t.type === "Sell" ? -t.shares : t.shares);
  }, 0);
  const tradeCash = (d) => tx.reduce((c, t) => c + (t.date > d ? 0 : t.type === "Buy" ? -t.shares * t.price : t.type === "Sell" ? t.shares * t.price : 0), 0);
  const distEvents = [];
  Object.entries(dists).forEach(([id, list]) => list.forEach(([ex, a]) => ex > inc && distEvents.push({ ex, cash: sharesAt(id, ex, true) * a })));
  const distCash = (d) => distEvents.reduce((c, e) => c + (e.ex <= d ? e.cash : 0), 0);

  const insts = cfg.instruments;
  const nav = [], bmv = [], mv = [];
  dates.forEach((d, k) => {
    const row = {};
    let tot = 0;
    insts.forEach((i) => { row[i.id] = sharesAt(i.id, d) * px[i.id][k]; tot += row[i.id]; });
    row.cash = tradeCash(d) + distCash(d);
    mv.push(row);
    nav.push(tot + row.cash);
    bmv.push(bm.equity.units * px[bm.equity.id][k] + bm.bonds.units * bm.bonds.basePrice * px[bm.bonds.id][k] / px[bm.bonds.id][0]);
  });
  const fee = cfg.fictitiousCostsPA;
  const yf = (d) => (Date.parse(d) - Date.parse(inc)) / 864e5 / 365;
  const netF = (d0, d1) => Math.pow(1 - fee / 4, 4 * (yf(d1) - yf(d0)));
  const N = dates.length - 1, last = dates[N];

  // ---- KPIs
  const pfG = nav[N] / nav[0] - 1, pfN = (1 + pfG) * netF(inc, last) - 1, bmR = bmv[N] / bmv[0] - 1;
  const qStartIdx = (() => { const q0 = last.slice(0, 5) + String(Math.floor((+last.slice(5, 7) - 1) / 3) * 3 + 1).padStart(2, "0") + "-01";
    let k = 0; dates.forEach((d, i) => { if (d < q0) k = i; }); return k; })();
  const qG = nav[N] / nav[qStartIdx] - 1, qN = (1 + qG) * netF(dates[qStartIdx], last) - 1, qB = bmv[N] / bmv[qStartIdx] - 1;
  set("asof", "Stand: <b>" + fmtD(last) + "</b> (Schlusskurse)");
  set("k1", pct(pfN), cls(pfN)); set("k1h", "vor Kosten " + pct(pfG));
  set("k2", pct(bmR), cls(bmR)); set("k2h", "Differenz " + pp(pfN - bmR));
  set("k3", pct(qN), cls(qN)); set("k3h", "Benchmark " + pct(qB) + " · seit " + fmtD(dates[qStartIdx]));
  const eq = insts.filter((i) => i.sleeve === "Aktien").reduce((s, i) => s + mv[N][i.id], 0);
  const fi = insts.filter((i) => i.sleeve === "Anleihen").reduce((s, i) => s + mv[N][i.id], 0);
  set("k4", Math.round(eq / nav[N] * 100) + " / " + Math.round(fi / nav[N] * 100));

  // ---- chart
  const sample = (f) => {
    const keep = [];
    dates.forEach((d, k) => {
      if (k === 0 || k === N || f === "d") return keep.push(k);
      const nxt = dates[k + 1];
      const key = (x) => f === "m" ? x.slice(0, 7) : (() => { const t = new Date(x); const day = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - day); return t.toISOString().slice(0, 10); })();
      if (key(d) !== key(nxt)) keep.push(k);
    });
    return keep;
  };
  const state = { freq: "d", range: "all", cost: "net" };
  let chart;
  function draw() {
    let from = 0;
    if (state.range === "q") from = qStartIdx;
    if (state.range === "3m" || state.range === "1m") {
      const t = new Date(last); t.setUTCMonth(t.getUTCMonth() - (state.range === "3m" ? 3 : 1));
      const lim = t.toISOString().slice(0, 10);
      dates.forEach((d, k) => { if (d <= lim) from = k; });
    }
    const ks = sample(state.freq).filter((k) => k >= from);
    if (ks[0] !== from) ks.unshift(from);
    const d0 = dates[from];
    const pf = ks.map((k) => 100 * nav[k] / nav[from] * (state.cost === "net" ? netF(d0, dates[k]) : 1));
    const b = ks.map((k) => 100 * bmv[k] / bmv[from]);
    const labels = ks.map((k) => fmtD(dates[k]));
    const ds = [
      { label: "Musterportfolio" + (state.cost === "net" ? " (nach fikt. Kosten)" : " (vor Kosten)"), data: pf, borderColor: css("--pf"), backgroundColor: css("--pf"), borderWidth: 2, pointRadius: 0, tension: 0 },
      { label: cfg.benchmark.label, data: b, borderColor: css("--bm"), backgroundColor: css("--bm"), borderWidth: 2, borderDash: [5, 3], pointRadius: 0, tension: 0 },
    ];
    set("chartnote", "Index: " + fmtD(d0) + " = 100. Musterportfolio " + pct(pf[pf.length - 1] / 100 - 1) + ", Benchmark " + pct(b[b.length - 1] / 100 - 1) + " im gewählten Zeitraum.");
    if (chart) { chart.data.labels = labels; chart.data.datasets = ds; chart.update(); return; }
    chart = new Chart(document.getElementById("chart"), {
      type: "line", data: { labels, datasets: ds },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top", align: "start", labels: { color: css("--ink2"), boxWidth: 14, boxHeight: 2 } },
          tooltip: { callbacks: { label: (c) => " " + c.dataset.label + ": " + c.parsed.y.toFixed(2).replace(".", ",") } },
        },
        scales: {
          x: { ticks: { color: css("--muted"), maxTicksLimit: 9, maxRotation: 0 }, grid: { display: false } },
          y: { ticks: { color: css("--muted") }, grid: { color: css("--line") } },
        },
      },
    });
  }
  document.querySelectorAll(".seg").forEach((seg) => seg.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    state[seg.id] = b.dataset.v; draw();
  }));
  draw();

  // ---- quarter table (long-term view)
  const qEnds = [];
  dates.forEach((d, k) => { if (k > 0 && (k === N || Math.floor((+d.slice(5, 7) - 1) / 3) !== Math.floor((+dates[k + 1].slice(5, 7) - 1) / 3) || d.slice(0, 4) !== dates[k + 1].slice(0, 4))) qEnds.push(k); });
  let prev = 0, rows = "<tr><th>Zeitraum</th><th>Musterportfolio</th><th>Benchmark</th><th>Differenz</th></tr>";
  qEnds.forEach((k) => {
    const m = +dates[k].slice(5, 7), q = Math.floor((m - 1) / 3) + 1;
    const r = (nav[k] / nav[prev]) * netF(dates[prev], dates[k]) - 1, rb = bmv[k] / bmv[prev] - 1;
    rows += `<tr><td>Q${q} ${dates[k].slice(0, 4)}${k === N && Date.now() < Date.UTC(+dates[k].slice(0, 4), q * 3, 1) ? " (laufend)" : ""}</td><td class="${cls(r)}">${pct(r)}</td><td>${pct(rb)}</td><td>${pp(r - rb)}</td></tr>`;
    prev = k;
  });
  rows += `<tr class="tot"><td>Seit Auflage</td><td class="${cls(pfN)}">${pct(pfN)}</td><td>${pct(bmR)}</td><td>${pp(pfN - bmR)}</td></tr>`;
  set("qtab", rows);

  // ---- allocation bar
  const cash = mv[N].cash;
  const parts = [["Aktien", eq, css("--pf")], ["Anleihen", fi, css("--bm")], ["Liquidität", cash, css("--muted")]];
  set("allocbar", parts.map(([n, v, c]) => `<div style="width:${v / nav[N] * 100}%;background:${c}" title="${n} ${w1(v / nav[N])}">${v / nav[N] > 0.06 ? w1(v / nav[N]) : ""}</div>`).join(""));
  set("alloclegend", parts.map(([n, v, c]) => `<span><span class="dot" style="background:${c}"></span>${n} ${w1(v / nav[N])}</span>`).join("") +
    `<span>Strategie: ${Object.entries(cfg.strategy).map(([k, v]) => k + " " + Math.round(v * 100) + " %").join(" / ")}</span>`);

  // ---- holdings tables
  function holdings(sleeve, el) {
    const list = insts.filter((i) => i.sleeve === sleeve).sort((a, b) => mv[N][b.id] - mv[N][a.id]);
    const tot = list.reduce((s, i) => s + mv[N][i.id], 0);
    let h = "<tr><th>Anlage</th><th>Anteil gesamt</th><th>im Segment</th><th>Seit Auflage</th><th>Vortag</th></tr>";
    list.forEach((i) => {
      if (mv[N][i.id] <= 0) return;
      const firstBuy = tx.find((t) => t.id === i.id && (t.type === "Buy" || t.type === "Opening"));
      const base = firstBuy && firstBuy.date > inc ? firstBuy.price : cfg.startPrices[i.id];
      const since = px[i.id][N] / base - 1, day = px[i.id][N] / px[i.id][N - 1] - 1;
      h += `<tr><td class="l">${i.region}${firstBuy && firstBuy.date > inc ? "*" : ""}<span class="isin">${i.name} · ${i.isin}</span></td><td>${w1(mv[N][i.id] / nav[N])}</td><td>${w1(mv[N][i.id] / tot)}</td><td class="${cls(since)}">${pct(since, 1)}</td><td class="${cls(day)}">${pct(day, 1)}</td></tr>`;
    });
    h += `<tr class="tot"><td class="l">${sleeve} gesamt</td><td>${w1(tot / nav[N])}</td><td>100 %</td><td></td><td></td></tr>`;
    set(el, h);
  }
  holdings("Aktien", "eqtab"); holdings("Anleihen", "fitab");

  // ---- changes log, costs, footer
  set("log", cfg.changes.map((c) => `<li><b>${fmtD(c.date)}:</b> ${c.text}</li>`).join(""));
  const ter = insts.reduce((s, i) => s + i.ter * mv[N][i.id] / nav[N], 0);
  const f2 = (x) => (x * 100).toFixed(2).replace(".", ",") + " %";
  let ct = "<tr><th>Position</th><th>% p. a.</th></tr>";
  ct += `<tr><td class="l">ETF-Produktkosten (in den Kursen enthalten)</td><td>${f2(ter)}</td></tr>`;
  ct += `<tr><td class="l">Fiktive Verwaltungskosten (Annahme, abgezogen)</td><td>${f2(fee)}</td></tr>`;
  ct += `<tr class="tot"><td class="l">Musterportfolio gesamt</td><td>${f2(ter + fee)}</td></tr>`;
  ct += `<tr><td class="l" colspan="2" style="color:var(--ink2);font-size:12px;padding-top:12px">Zum Vergleich (typisch):</td></tr>`;
  cfg.comparison.forEach((c) => { ct += `<tr><td class="l">${c.label}</td><td>≈ ${f2(c.pa)}</td></tr>`; });
  set("costtab", ct);
  set("pub", cfg.publisher);
  set("bmdesc", cfg.benchmark.description);
  if (upd.updated) set("upd", "Daten aktualisiert: " + upd.updated.replace("T", " ").replace("Z", " UTC"));
})().catch((e) => { document.getElementById("asof").textContent = "Daten konnten nicht geladen werden."; console.error(e); });
