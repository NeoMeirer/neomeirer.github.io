/*
 * Kicker-Ticker Diagramme – kleine SVG-Helfer ohne Abhängigkeiten.
 *  - lineChart: Verlauf mit Hervorhebung einer Linie, Fadenkreuz + Tooltip
 *  - sparkline: Mini-Verlauf für Tabellenzeilen
 * Farben kommen aus CSS-Variablen (--kt-accent, --kt-muted …), Texte werden per textContent gesetzt.
 */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  // „Schöne" Achsenwerte (1, 2, 5 × 10^n)
  function niceTicks(min, max, count) {
    if (min === max) { min -= 1; max += 1; }
    const raw = (max - min) / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || 10 * mag;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
    return { lo, hi, ticks };
  }

  function sparkline(values, opts = {}) {
    const w = opts.width || 88, h = opts.height || 24, pad = 3;
    const svg = svgEl('svg', { width: w, height: h, viewBox: `0 0 ${w} ${h}`, class: 'kt-spark', 'aria-hidden': 'true' });
    if (values.length < 2) return svg;
    const min = Math.min(...values), max = Math.max(...values);
    const span = max - min || 1;
    const x = i => pad + (i / (values.length - 1)) * (w - 2 * pad);
    const y = v => h - pad - ((v - min) / span) * (h - 2 * pad);
    svgEl('path', { d: values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(''), class: 'kt-spark-line' }, svg);
    svgEl('circle', { cx: x(values.length - 1), cy: y(values[values.length - 1]), r: 2.5, class: 'kt-spark-dot' }, svg);
    return svg;
  }

  /*
   * lineChart(host, {
   *   series: [{ id, label, points: [{x: ms, y, meta}] }],
   *   highlight: id,                 // hervorgehobene Linie; übrige grau
   *   height, yLabel,
   *   formatX: ms → string, formatTip: (point, series) → [{text, strong}]
   * })
   */
  function lineChart(host, cfg) {
    host.textContent = '';
    const width = Math.max(280, host.clientWidth || 600);
    const height = cfg.height || 280;
    const m = { top: 16, right: 56, bottom: 28, left: 44 };
    const iw = width - m.left - m.right, ih = height - m.top - m.bottom;

    const all = cfg.series.flatMap(s => s.points);
    if (!all.length) { host.innerHTML = '<p class="kt-empty">Noch keine Spiele.</p>'; return; }
    const hl = cfg.series.find(s => s.id === cfg.highlight);
    const xMin = Math.min(...all.map(p => p.x)), xMax = Math.max(...all.map(p => p.x));
    const yVals = all.map(p => p.y);
    const yt = niceTicks(Math.min(...yVals), Math.max(...yVals), 4);
    const X = v => m.left + (xMax === xMin ? iw / 2 : ((v - xMin) / (xMax - xMin)) * iw);
    const Y = v => m.top + ih - ((v - yt.lo) / (yt.hi - yt.lo || 1)) * ih;

    const svg = svgEl('svg', { width, height, viewBox: `0 0 ${width} ${height}`, class: 'kt-chart', role: 'img' });
    if (cfg.ariaLabel) svg.setAttribute('aria-label', cfg.ariaLabel);

    // Raster + y-Achse
    const grid = svgEl('g', { class: 'kt-grid' }, svg);
    yt.ticks.forEach(t => {
      svgEl('line', { x1: m.left, x2: m.left + iw, y1: Y(t), y2: Y(t) }, grid);
      const lab = svgEl('text', { x: m.left - 8, y: Y(t) + 4, 'text-anchor': 'end', class: 'kt-axis' }, svg);
      lab.textContent = t.toLocaleString('de-DE');
    });
    // x-Achse: ~5 Datums-Ticks
    const nx = Math.max(2, Math.min(6, Math.floor(iw / 90)));
    for (let i = 0; i <= nx; i++) {
      const v = xMin + (i / nx) * (xMax - xMin);
      const lab = svgEl('text', { x: X(v), y: height - 8, 'text-anchor': i === 0 ? 'start' : i === nx ? 'end' : 'middle', class: 'kt-axis' }, svg);
      lab.textContent = cfg.formatX ? cfg.formatX(v) : String(v);
    }

    const path = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
    // Kontextlinien zuerst (grau), Hervorhebung zuletzt
    cfg.series.filter(s => s !== hl).forEach(s => {
      if (s.points.length) svgEl('path', { d: path(s.points), class: 'kt-line-ctx' }, svg);
    });
    let endDot = null;
    if (hl && hl.points.length) {
      svgEl('path', { d: path(hl.points), class: 'kt-line-hl' }, svg);
      const last = hl.points[hl.points.length - 1];
      endDot = svgEl('circle', { cx: X(last.x), cy: Y(last.y), r: 4.5, class: 'kt-dot-hl' }, svg);
      const lab = svgEl('text', { x: X(last.x) + 9, y: Y(last.y) + 4, class: 'kt-endlabel' }, svg);
      lab.textContent = last.y.toLocaleString('de-DE');
    }

    // Hover-Ebene: Fadenkreuz rastet am nächsten Punkt der hervorgehobenen Linie ein
    const cross = svgEl('line', { y1: m.top, y2: m.top + ih, class: 'kt-cross', visibility: 'hidden' }, svg);
    const hoverDot = svgEl('circle', { r: 5, class: 'kt-dot-hl', visibility: 'hidden' }, svg);
    const overlay = svgEl('rect', { x: m.left, y: m.top, width: iw, height: ih, fill: 'transparent', tabindex: 0 }, svg);
    const tip = document.getElementById('kt-tooltip');
    const pts = hl ? hl.points : [];
    let focusIdx = pts.length - 1;

    function show(idx, clientX, clientY) {
      if (!pts.length) return;
      focusIdx = Math.max(0, Math.min(pts.length - 1, idx));
      const p = pts[focusIdx];
      cross.setAttribute('x1', X(p.x)); cross.setAttribute('x2', X(p.x));
      cross.setAttribute('visibility', 'visible');
      hoverDot.setAttribute('cx', X(p.x)); hoverDot.setAttribute('cy', Y(p.y));
      hoverDot.setAttribute('visibility', 'visible');
      if (tip && cfg.formatTip) {
        tip.textContent = '';
        cfg.formatTip(p, hl).forEach(line => {
          const d = document.createElement('div');
          if (line.strong) d.className = 'kt-tip-strong';
          if (line.muted) d.className = 'kt-tip-muted';
          d.textContent = line.text;
          tip.appendChild(d);
        });
        tip.hidden = false;
        const r = svg.getBoundingClientRect();
        const px = clientX != null ? clientX : r.left + X(p.x);
        const py = clientY != null ? clientY : r.top + Y(p.y);
        const tw = tip.offsetWidth, th = tip.offsetHeight;
        let left = px + 14, top = py - th - 10;
        if (left + tw > window.innerWidth - 8) left = px - tw - 14;
        if (top < 8) top = py + 14;
        tip.style.left = left + 'px';
        tip.style.top = top + 'px';
      }
    }
    function hide() {
      cross.setAttribute('visibility', 'hidden');
      hoverDot.setAttribute('visibility', 'hidden');
      if (tip) tip.hidden = true;
    }
    function nearest(clientX) {
      const r = svg.getBoundingClientRect();
      const x = (clientX - r.left) * (width / r.width);
      let best = 0, bd = Infinity;
      pts.forEach((p, i) => { const d = Math.abs(X(p.x) - x); if (d < bd) { bd = d; best = i; } });
      return best;
    }
    overlay.addEventListener('pointermove', e => show(nearest(e.clientX), e.clientX, e.clientY));
    overlay.addEventListener('pointerdown', e => show(nearest(e.clientX), e.clientX, e.clientY));
    overlay.addEventListener('pointerleave', hide);
    overlay.addEventListener('blur', hide);
    overlay.addEventListener('focus', () => show(focusIdx));
    overlay.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft') { show(focusIdx - 1); e.preventDefault(); }
      if (e.key === 'ArrowRight') { show(focusIdx + 1); e.preventDefault(); }
    });

    if (endDot) svg.appendChild(endDot);
    host.appendChild(svg);
  }

  root.KickerCharts = { lineChart, sparkline, niceTicks };
})(window);
