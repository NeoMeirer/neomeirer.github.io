/*
 * Mensa-Ranking – reine Logik ohne DOM und ohne Supabase.
 * Im Browser als window.MensaLogic, in Node per require() testbar (_tests/mensa/logic.test.mjs).
 */
(function (root) {
  'use strict';

  const MIN_VOTES = 3;   // darunter gilt ein Schnitt als „wenige Stimmen“ und zählt nicht für Bestenlisten
  const FILLING = { 1: 'eher leicht', 2: 'sättigend', 3: 'sehr sättigend' };
  const DAY = 864e5;

  // ── Namen ─────────────────────────────────────────────────────────────────
  // Exakt wie public.mensa_name_key() in _supabase/mensa_v1.sql (Test: _tests/mensa/db.test.mjs).
  const REPL = [['Ä', 'ae'], ['ä', 'ae'], ['Ö', 'oe'], ['ö', 'oe'], ['Ü', 'ue'], ['ü', 'ue'],
                ['ß', 'ss'], ['ẞ', 'ss'], ['Æ', 'ae'], ['æ', 'ae']];
  const FROM = 'ÁÀÂÃÅáàâãåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕØóòôõøÚÙÛúùûÇçÑñ';
  const TO   = 'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUuuuCcNn';

  function nameKey(name) {
    let s = String(name ?? '').normalize('NFC');
    for (const [a, b] of REPL) s = s.split(a).join(b);
    s = Array.from(s, c => { const i = FROM.indexOf(c); return i < 0 ? c : TO[i]; }).join('');
    return s.replace(/[A-Z]/g, c => c.toLowerCase()).replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // Anzeigename säubern: Leerraum zusammenfassen, NFC.
  function cleanName(name) {
    return String(name ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  }

  function bigrams(s) {
    const out = new Map();
    const t = ` ${s} `;
    for (let i = 0; i < t.length - 1; i++) {
      const g = t.slice(i, i + 2);
      out.set(g, (out.get(g) || 0) + 1);
    }
    return out;
  }

  // Sørensen-Dice über Buchstabenpaare, 0…1
  function dice(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const A = bigrams(a), B = bigrams(b);
    let inter = 0, total = 0;
    for (const [g, n] of A) { inter += Math.min(n, B.get(g) || 0); total += n; }
    for (const n of B.values()) total += n;
    return (2 * inter) / total;
  }

  // Wie gut passt die Eingabe zu einem Gerichtsnamen? 1 = exakt gleicher Schlüssel.
  // Nur für Vorschläge – zugeordnet wird ausschließlich per Tipp oder bei exakt gleichem Schlüssel.
  function matchScore(query, name) {
    const q = nameKey(query), k = nameKey(name);
    if (!q || !k) return 0;
    if (q === k) return 1;
    if (k.startsWith(q)) return 0.9;
    const qt = q.split(' '), kt = k.split(' ');
    if (qt.every(t => kt.some(w => w.startsWith(t)))) return 0.85;
    if (k.includes(q)) return 0.8;
    if (q.includes(k)) return 0.7;
    return 0.75 * dice(q.replace(/ /g, ''), k.replace(/ /g, ''));
  }

  // Vorschläge beim Tippen. dishes: [{id, name, …}], extra: id → Zusatzinfos (z. B. Häufigkeit).
  function suggest(query, dishes, { limit = 6, min = 0.4, popularity = () => 0 } = {}) {
    if (nameKey(query).length < 2) return [];
    return dishes
      .map(d => ({ dish: d, score: matchScore(query, d.name) }))
      .filter(x => x.score >= min)
      .sort((a, b) => b.score - a.score || popularity(b.dish) - popularity(a.dish) || a.dish.name.localeCompare(b.dish.name, 'de'))
      .slice(0, limit)
      .map(x => ({ ...x, exact: x.score === 1 }));
  }

  function findExact(name, dishes) {
    const k = nameKey(name);
    return k ? dishes.find(d => nameKey(d.name) === k) || null : null;
  }

  // Ab dieser Ähnlichkeit fragen wir vor dem Anlegen eines neuen Gerichts nach.
  const SIMILAR = 0.6;
  function similarDishes(name, dishes, limit = 4) {
    return suggest(name, dishes, { limit, min: SIMILAR }).filter(x => !x.exact);
  }

  // Suche im Verlauf: jedes Wort muss im Namen vorkommen (Umlaute/Groß-klein egal).
  function matchesSearch(query, name) {
    const q = nameKey(query);
    if (!q) return true;
    const k = nameKey(name);
    return q.split(' ').every(t => k.includes(t));
  }

  // ── Bewertungen ───────────────────────────────────────────────────────────
  // st: Zeile aus mensa_serving_stats() oder undefined (= noch keine Stimme)
  function summarize(st) {
    const votes = Number(st?.votes) || 0;
    const sum = Number(st?.rating_sum) || 0;
    return {
      votes, sum,
      avg: votes ? sum / votes : null,
      few: votes > 0 && votes < MIN_VOTES,
      filling: [Number(st?.filling_light) || 0, Number(st?.filling_medium) || 0, Number(st?.filling_heavy) || 0]
    };
  }

  // Mehrere Ausgaben zusammenfassen: nach Stimmen gewichtet (Summe/Anzahl), nicht Schnitt der Schnitte.
  function combine(list) {
    let votes = 0, sum = 0;
    const filling = [0, 0, 0];
    for (const s of list) {
      votes += s.votes; sum += s.sum;
      s.filling.forEach((n, i) => { filling[i] += n; });
    }
    return { votes, sum, avg: votes ? sum / votes : null, few: votes > 0 && votes < MIN_VOTES, filling, servings: list.length };
  }

  const formatAvg = avg => (Math.round(avg * 10) / 10).toFixed(1).replace('.', ',');
  const votesLabel = n => n === 1 ? '1 Stimme' : `${n} Stimmen`;

  function scoreText(s) {
    return s.votes ? `Ø ${formatAvg(s.avg)} · ${votesLabel(s.votes)}` : 'Noch nicht bewertet';
  }

  // „meist sättigend (3 von 4)“ – nur wenn jemand etwas angegeben hat
  function fillingText(s) {
    const total = s.filling.reduce((a, b) => a + b, 0);
    if (!total) return null;
    const max = Math.max(...s.filling);
    const top = [1, 2, 3].filter(k => s.filling[k - 1] === max).map(k => FILLING[k]);
    return `meist ${top.join(' / ')} (${top.length > 1 ? 'je ' + max : max + ' von ' + total})`;
  }

  // Frühere Ausgaben desselben Gerichts (strikt vor dem Tag dieser Ausgabe).
  function dishHistory(serving, servings, statsOf) {
    const earlier = servings.filter(s => s.dish_id === serving.dish_id && s.id !== serving.id && s.served_on < serving.served_on);
    const c = combine(earlier.map(s => statsOf(s.id)));
    c.last = earlier.reduce((m, s) => (s.served_on > m ? s.served_on : m), '');
    return c;
  }

  // Bestenliste der Gerichte: erst ab MIN_VOTES Stimmen nach Schnitt, danach der Rest.
  function rankDishes(dishes, servings, statsOf) {
    const byDish = new Map();
    for (const s of servings) {
      if (!byDish.has(s.dish_id)) byDish.set(s.dish_id, []);
      byDish.get(s.dish_id).push(s);
    }
    return dishes
      .filter(d => byDish.has(d.id))
      .map(d => {
        const list = byDish.get(d.id);
        const c = combine(list.map(s => statsOf(s.id)));
        c.last = list.reduce((m, s) => (s.served_on > m ? s.served_on : m), '');
        return { dish: d, ...c };
      })
      .sort((a, b) => {
        const ra = a.votes >= MIN_VOTES, rb = b.votes >= MIN_VOTES;
        if (ra !== rb) return ra ? -1 : 1;
        if (ra) return b.avg - a.avg || b.votes - a.votes;
        if (!!a.votes !== !!b.votes) return a.votes ? -1 : 1;
        return b.votes - a.votes || (b.avg ?? 0) - (a.avg ?? 0) || a.dish.name.localeCompare(b.dish.name, 'de');
      });
  }

  // ── Datum ─────────────────────────────────────────────────────────────────
  const pad = n => String(n).padStart(2, '0');
  // Lokales Datum (nicht UTC!) als YYYY-MM-DD
  function isoDate(d = new Date()) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function parseIso(iso) {
    const [y, m, d] = String(iso).split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function addDays(iso, n) {
    const d = parseIso(iso);
    d.setDate(d.getDate() + n);
    return isoDate(d);
  }
  function dayLabel(iso, today = isoDate()) {
    const diff = Math.round((parseIso(today) - parseIso(iso)) / DAY);
    if (diff === 0) return 'Heute';
    if (diff === 1) return 'Gestern';
    const d = parseIso(iso);
    const sameYear = d.getFullYear() === parseIso(today).getFullYear();
    return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', ...(sameYear ? {} : { year: 'numeric' }) });
  }

  // ── Preis ─────────────────────────────────────────────────────────────────
  // "3,40" / "3.4" / "3 €" → Cent; leer → null; ungültig → NaN
  function parsePrice(input) {
    const s = String(input ?? '').replace(/\s|€/g, '');
    if (!s) return null;
    const m = /^(\d{1,2})(?:[.,](\d{1,2}))?$/.exec(s);
    if (!m) return NaN;
    const cents = Number(m[1]) * 100 + Number(((m[2] || '') + '00').slice(0, 2));
    return cents <= 5000 ? cents : NaN;
  }
  const formatPrice = cents => (cents / 100).toFixed(2).replace('.', ',') + ' €';

  // ── Speiseplan (OpenMensa) ────────────────────────────────────────────────
  // Kürzel wie „(vegan,3,GlWe,Se)“ entfernen, Hinweise wie „(je 100g)“ behalten.
  function isCodeList(inner) {
    const parts = inner.split(',').map(p => p.trim()).filter(Boolean);
    return parts.length > 0 && parts.every(p => /^(\d{1,2}[a-z]?|[A-Za-z]{1,5}|vegan|vegetarisch)$/i.test(p));
  }
  function cleanMenuName(raw) {
    const first = String(raw ?? '').split('\n')[0];
    return cleanName(first.replace(/\s*\(([^()]*)\)/g, (m, inner) => (isCodeList(inner) ? '' : m)));
  }
  // Mahlzeiten eines Tages → [{name, price_cents, category}], ohne Doppelte
  function parseMenu(meals) {
    const seen = new Set();
    const out = [];
    for (const m of Array.isArray(meals) ? meals : []) {
      const name = cleanMenuName(m?.name);
      const key = nameKey(name);
      if (!key || key.length < 2 || seen.has(key)) continue;
      seen.add(key);
      const perWeight = /je\s*100\s*g/i.test(String(m?.name));
      const p = m?.prices?.students;
      out.push({
        name: name.slice(0, 120),
        price_cents: !perWeight && typeof p === 'number' && p >= 0 && p <= 50 ? Math.round(p * 100) : null,
        category: m?.category || ''
      });
    }
    return out;
  }

  // ── Fotos ─────────────────────────────────────────────────────────────────
  // Zielgröße: längste Seite höchstens max, nie vergrößern
  function fitSize(w, h, max) {
    const f = Math.min(1, max / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * f)), h: Math.max(1, Math.round(h * f)) };
  }
  // Speicherpfade: eigener Ordner (Storage-Policy), zufälliger Name (nichts überschreibbar)
  function photoPaths(userId, servingId, rand) {
    const base = `${userId}/${servingId}-${rand}`;
    return { photo: `${base}.jpg`, thumb: `${base}-t.jpg` };
  }

  const api = {
    MIN_VOTES, FILLING, SIMILAR,
    nameKey, cleanName, dice, matchScore, suggest, findExact, similarDishes, matchesSearch,
    summarize, combine, formatAvg, votesLabel, scoreText, fillingText, dishHistory, rankDishes,
    isoDate, addDays, dayLabel, parsePrice, formatPrice,
    cleanMenuName, parseMenu, fitSize, photoPaths
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MensaLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
