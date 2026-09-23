/*
 * Kicker-Ticker – App
 * Datenquelle: Supabase (players, seasons, games, season_snapshots).
 * Alle Wertungen werden im Browser aus den Spielen berechnet (siehe rating.js).
 */
(function () {
  'use strict';

  const R = window.KickerRating;
  const C = window.KickerCharts;
  const sb = window.supabase.createClient(window.KICKER_CONFIG.url, window.KICKER_CONFIG.key);

  const PLACEMENT = 10;      // ab so vielen Spielen erscheint man in der Rangliste
  const UNDO_MINUTES = 15;   // so lange darf man eigene Einträge selbst löschen (siehe RLS)
  const DAY = 864e5;

  const TABS = {
    rank: 'rangliste', player: 'spieler', duos: 'duos', lineup: 'aufstellung',
    games: 'spiele', archive: 'archiv', entry: 'eintragen', admin: 'admin', login: 'anmelden'
  };
  // welche Filter pro Bereich sichtbar sind
  const FILTERS = {
    rank: ['mode', 'scope'], player: ['mode', 'scope'], duos: ['scope'], lineup: ['mode', 'scope'],
    games: ['mode', 'scope'], archive: ['mode'], entry: [], admin: [], login: []
  };

  const S = {
    players: [], byId: new Map(), seasons: [], games: [], active: null,
    user: null, admin: false, loaded: false, error: null,
    tab: 'rank', mode: 'duo', scope: 'season',
    player: null, lineup: new Set(), archive: null, gamesLimit: 40, duoMin: 5,
    entry: { mode: 'duo', positions: true, slots: {} }
  };
  const cache = new Map();

  // ── Helfer ────────────────────────────────────────────────────────────────
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nameOf = id => S.byId.get(id)?.name ?? '?';
  const pct = (x, d = 0) => (x * 100).toFixed(d).replace('.', ',') + ' %';
  const signed = n => n > 0 ? '+' + n : n < 0 ? '−' + Math.abs(n) : '±0';
  const num = n => Number(n).toLocaleString('de-DE');
  const fmtDay = ms => new Date(ms).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  const fmtDate = ms => new Date(ms).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const fmtTime = ms => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const deltaClass = n => n > 0 ? 'kt-up' : n < 0 ? 'kt-down' : '';
  const team = ids => ids.map(id => esc(nameOf(id))).join(' & ');

  function dayLabel(ms) {
    const d = new Date(ms); d.setHours(0, 0, 0, 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((today - d) / DAY);
    if (diff === 0) return 'Heute';
    if (diff === 1) return 'Gestern';
    return d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function seasonById(id) { return S.seasons.find(s => s.id === id); }
  function scopeSeasonId(scope) { return scope === 'season' ? S.active?.id ?? null : scope === 'all' ? null : scope; }
  function scopeName(scope) {
    if (scope === 'all') return 'Ewige Tabelle';
    const s = seasonById(scopeSeasonId(scope));
    return s ? s.name : 'Keine Saison';
  }

  function gamesIn(scope) {
    if (scope === 'all') return S.games;
    const sid = scopeSeasonId(scope);
    return sid == null ? [] : S.games.filter(g => g.season_id === sid);
  }

  function memo(key, fn) {
    if (!cache.has(key)) cache.set(key, fn());
    return cache.get(key);
  }

  const replayFor = (scope, mode) => memo(`rep|${scope}|${mode}`, () => R.replay(gamesIn(scope), mode));

  // ── Statistik ─────────────────────────────────────────────────────────────
  function standings(scope, mode) {
    return memo(`st|${scope}|${mode}`, () => {
      const rep = replayFor(scope, mode);
      const per = new Map();
      rep.events.forEach(ev => {
        const g = ev.game;
        g.teams.forEach((t, ti) => t.forEach(id => {
          if (!per.has(id)) per.set(id, []);
          per.get(id).push({
            ev, ti, won: g.winner === ti, gf: g.scores[ti], ga: g.scores[1 - ti],
            delta: ev.changes[id].delta, p: ti === 0 ? ev.pTeam1 : 1 - ev.pTeam1,
            partner: t.find(x => x !== id) || null, opponents: g.teams[1 - ti]
          });
        }));
      });
      const cutoff = Date.now() - 7 * DAY;
      const rows = [...rep.ratings].map(([id, r]) => {
        const list = per.get(id) || [];
        const hist = rep.history.get(id) || [];
        const wins = list.filter(x => x.won).length;
        let streak = 0;
        for (let i = list.length - 1; i >= 0; i--) {
          const w = list[i].won;
          if (streak === 0) streak = w ? 1 : -1;
          else if ((streak > 0) === w) streak += w ? 1 : -1;
          else break;
        }
        const recent = hist.filter(h => h.time >= cutoff).length;
        const before = [...hist].reverse().find(h => h.time < cutoff);
        return {
          id, name: nameOf(id), r, rating: R.display(r), ord: r.mu, spread: R.spread(r),
          games: list.length, wins, losses: list.length - wins,
          gf: list.reduce((s, x) => s + x.gf, 0), ga: list.reduce((s, x) => s + x.ga, 0),
          streak, recent,
          trend: recent === 0 ? 0 : before ? R.display(r) - R.display(before.rating) : null,
          form: list.slice(-5).map(x => x.won),
          spark: hist.slice(-30).map(h => R.display(h.rating)),
          list, placed: list.length >= PLACEMENT
        };
      }).sort((a, b) => (b.placed - a.placed) || (b.ord - a.ord));
      let rank = 0;
      rows.forEach(row => { row.rank = row.placed ? ++rank : null; });
      return { rep, rows, per };
    });
  }

  function positionTable(scope) {
    return memo(`pos|${scope}`, () => {
      const rep = replayFor(scope, 'duo');
      const cnt = { def: new Map(), att: new Map() };
      const bump = (m, id, won) => {
        const c = m.get(id) || { games: 0, wins: 0 };
        c.games++; if (won) c.wins++;
        m.set(id, c);
      };
      rep.events.forEach(ev => {
        if (!ev.game.positions) return;
        ev.game.teams.forEach(([d, a], ti) => {
          const won = ev.game.winner === ti;
          bump(cnt.def, d, won); bump(cnt.att, a, won);
        });
      });
      const ids = new Set([...cnt.def.keys(), ...cnt.att.keys()]);
      const side = (key, id) => {
        const c = cnt[key].get(id);
        const r = rep.posRatings[key].get(id);
        return c ? { games: c.games, wins: c.wins, rating: R.display(r), ord: r.mu, mu: r.mu } : null;
      };
      const rows = [...ids].map(id => ({ id, name: nameOf(id), def: side('def', id), att: side('att', id) }));
      const total = rep.events.filter(e => e.game.positions).length;
      return { rows, total };
    });
  }

  // ── Daten laden ───────────────────────────────────────────────────────────
  async function fetchAll(table, order) {
    const out = [];
    const size = 1000;
    for (let from = 0; ; from += size) {
      const { data, error } = await sb.from(table).select('*').order(order, { ascending: true }).range(from, from + size - 1);
      if (error) throw error;
      out.push(...data);
      if (data.length < size) break;
    }
    return out;
  }

  async function loadData() {
    try {
      const [players, seasons, games] = await Promise.all([
        fetchAll('players', 'name'), fetchAll('seasons', 'id'), fetchAll('games', 'played_at')
      ]);
      S.players = players;
      S.byId = new Map(players.map(p => [p.id, p]));
      S.seasons = seasons;
      S.games = games;
      S.active = seasons.find(s => s.is_active) || null;
      S.loaded = true;
      S.error = null;
    } catch (e) {
      console.error(e);
      S.error = e;
    }
    cache.clear();
  }

  async function reloadGames() {
    try {
      S.games = await fetchAll('games', 'played_at');
      cache.clear();
      // Formulare nicht unter den Fingern neu aufbauen
      if (S.tab === 'entry') updatePrediction();
      else if (S.tab !== 'admin') render();
    } catch (e) { console.error(e); }
  }

  async function refreshAuth() {
    const { data } = await sb.auth.getSession();
    S.user = data.session?.user ?? null;
    S.admin = false;
    if (S.user) {
      const { data: isAdmin, error } = await sb.rpc('is_admin');
      if (!error) S.admin = !!isAdmin;
      else {
        // Fallback, falls die SQL-Migration noch nicht gelaufen ist
        const { data: row } = await sb.from('admins').select('email').eq('email', S.user.email).maybeSingle();
        S.admin = !!row;
      }
    }
  }

  // ── Rendering: Rahmen ─────────────────────────────────────────────────────
  function render() {
    const root = $('#kt');
    root.querySelectorAll('[data-needs="login"]').forEach(b => { b.hidden = !S.user; });
    root.querySelectorAll('[data-needs="admin"]').forEach(b => { b.hidden = !S.admin; });
    if ((S.tab === 'entry' && !S.user) || (S.tab === 'admin' && !S.admin)) S.tab = S.user ? 'rank' : 'login';

    root.querySelectorAll('.kt-tabs [data-tab]').forEach(b => b.setAttribute('aria-current', b.dataset.tab === S.tab ? 'page' : 'false'));
    root.querySelectorAll('.kt-panel').forEach(p => { p.hidden = p.dataset.panel !== S.tab; });

    const vis = FILTERS[S.tab] || [];
    root.querySelectorAll('[data-filter]').forEach(g => {
      g.hidden = !vis.includes(g.dataset.filter);
      g.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.value === S[g.dataset.filter])));
    });
    $('#kt-filters').hidden = vis.length === 0;

    $('#kt-season').textContent = S.error ? 'Keine Verbindung zur Datenbank'
      : !S.loaded ? 'Lädt …'
      : S.active ? `Saison „${S.active.name}“ · ${gamesIn('season').length} Spiele` : 'Keine aktive Saison';

    $('#kt-auth').innerHTML = S.user
      ? `<span class="kt-muted">${S.admin ? 'Admin' : 'Angemeldet'}</span> <button class="kt-link" data-action="logout">Abmelden</button>`
      : `<button class="kt-link" data-tab="login">Anmelden</button>`;

    const panel = root.querySelector(`[data-panel="${S.tab}"]`);
    if (S.error && S.tab !== 'login') {
      panel.innerHTML = `<div class="kt-card kt-error"><h2>Daten konnten nicht geladen werden</h2>
        <p>Supabase ist gerade nicht erreichbar. Kostenlose Projekte werden nach 7 Tagen ohne Nutzung pausiert –
        dann im <a href="https://supabase.com/dashboard" target="_blank" rel="noopener">Supabase-Dashboard</a> „Restore“ klicken.</p>
        <p class="kt-muted">${esc(S.error.message || S.error)}</p></div>`;
      return;
    }
    if (!S.loaded && S.tab !== 'login') { panel.innerHTML = '<p class="kt-empty">Lädt …</p>'; return; }
    ({ rank: renderRank, player: renderPlayer, duos: renderDuos, lineup: renderLineup, games: renderGames,
       archive: renderArchive, entry: renderEntry, admin: renderAdmin, login: renderLogin })[S.tab](panel);
  }

  function setTab(tab, push = true) {
    if (!TABS[tab]) return;
    S.tab = tab;
    if (push) history.replaceState(null, '', '#' + TABS[tab]);
    render();
    window.scrollTo({ top: Math.min(window.scrollY, $('#kt').offsetTop), behavior: 'auto' });
  }

  // ── Stat-Kacheln & kleine Bausteine ───────────────────────────────────────
  const tile = (label, value, sub = '') =>
    `<div class="kt-tile"><div class="kt-tile-label">${label}</div><div class="kt-tile-value">${value}</div>${sub ? `<div class="kt-tile-sub">${sub}</div>` : ''}</div>`;

  const formDots = form => `<span class="kt-form" aria-label="Letzte Spiele: ${form.map(w => w ? 'Sieg' : 'Niederlage').join(', ')}">${
    form.map(w => `<span class="kt-formdot ${w ? 'kt-win' : 'kt-loss'}">${w ? 'S' : 'N'}</span>`).join('')}</span>`;

  const rateBar = (x, label) =>
    `<span class="kt-bar"><span class="kt-bar-fill" style="width:${Math.round(x * 100)}%"></span></span><span class="kt-bar-val">${label ?? pct(x)}</span>`;

  function streakText(s) {
    if (!s) return '—';
    const n = Math.abs(s);
    return s > 0 ? `${n} ${n === 1 ? 'Sieg' : 'Siege'}` : `${n} ${n === 1 ? 'Niederlage' : 'Niederl.'}`;
  }

  function trendCell(row) {
    if (row.trend === null) return '<span class="kt-muted">neu</span>';
    if (!row.recent) return '<span class="kt-muted">—</span>';
    return `<span class="${deltaClass(row.trend)}">${signed(row.trend)}</span>`;
  }

  function noSeasonHint() {
    return S.scope === 'season' && !S.active
      ? `<div class="kt-card"><p>Es läuft gerade keine Saison. ${S.admin ? 'Im Admin-Bereich kannst du eine starten.' : 'Ein Admin kann eine neue starten.'}</p></div>` : '';
  }

  // ── Rangliste ─────────────────────────────────────────────────────────────
  function renderRank(panel) {
    const { rep, rows } = standings(S.scope, S.mode);
    const placed = rows.filter(r => r.placed);
    const unplaced = rows.filter(r => !r.placed);
    const evs = rep.events;
    const week = evs.filter(e => e.game.time >= Date.now() - 7 * DAY).length;

    // Größte Überraschung: Sieg mit der kleinsten Siegchance
    let upset = null;
    evs.forEach(e => {
      const p = e.game.winner === 0 ? e.pTeam1 : 1 - e.pTeam1;
      if (!upset || p < upset.p) upset = { e, p };
    });
    const best = rows.filter(r => r.games).reduce((b, r) => (!b || r.streak > b.streak ? r : b), null);
    const leader = placed[0];

    let h = noSeasonHint();
    h += `<div class="kt-tiles">
      ${tile('Spiele', num(evs.length), week ? `${week} in den letzten 7 Tagen` : '')}
      ${tile('Spitze', leader ? esc(leader.name) : '—', leader ? `Wertung ${num(leader.rating)}` : `platziert ab ${PLACEMENT} Spielen`)}
      ${tile('Siegesserie', best && best.streak > 1 ? esc(best.name) : '—', best && best.streak > 1 ? `${best.streak} Siege in Folge` : 'aktuell keine')}
      ${tile('Größte Überraschung', upset && upset.p < 0.45 ? pct(upset.p) : '—',
        upset && upset.p < 0.45 ? `${team(upset.e.game.teams[upset.e.game.winner])} am ${fmtDay(upset.e.game.time)}` : 'Siegchance des Außenseiters')}
    </div>`;

    h += `<div class="kt-card"><div class="kt-card-head"><h2>Rangliste · ${esc(scopeName(S.scope))}</h2>
      <span class="kt-muted">${S.mode === 'duo' ? '2 gegen 2' : '1 gegen 1'}</span></div>`;
    if (!rows.length) {
      h += `<p class="kt-empty">Noch keine Spiele${S.mode === 'solo' ? ' im 1 gegen 1' : ''}.</p>`;
    } else {
      const tr = r => `<tr data-player="${esc(r.id)}" tabindex="0" class="${r.placed ? '' : 'kt-unplaced'}">
          <td class="kt-num kt-rankno">${r.rank ?? '–'}</td>
          <td><span class="kt-name">${esc(r.name)}</span></td>
          <td class="kt-num"><strong>${num(r.rating)}</strong></td>
          <td class="kt-num">${trendCell(r)}</td>
          <td class="kt-num">${r.games}</td>
          <td class="kt-num">${pct(r.wins / r.games)}</td>
          <td class="kt-opt">${formDots(r.form)}</td>
          <td class="kt-opt kt-sparkcell" data-spark="${esc(r.id)}"></td>
        </tr>`;
      h += `<div class="kt-scroll"><table class="kt-table kt-rank">
        <thead><tr><th class="kt-num">#</th><th>Spieler</th><th class="kt-num">Wertung</th><th class="kt-num">7 Tage</th>
        <th class="kt-num">Spiele</th><th class="kt-num">Siege</th><th class="kt-opt">Form</th><th class="kt-opt">Verlauf</th></tr></thead><tbody>
        ${placed.map(tr).join('')}
        ${unplaced.length ? `<tr class="kt-divider"><td colspan="8">Noch nicht platziert – ab ${PLACEMENT} Spielen</td></tr>${unplaced.map(tr).join('')}` : ''}
        </tbody></table></div>`;
    }
    h += '</div>';

    if (S.mode === 'duo') h += positionsCard(S.scope);
    h += explainer();
    panel.innerHTML = h;

    panel.querySelectorAll('[data-spark]').forEach(cell => {
      const row = rows.find(r => r.id === cell.dataset.spark);
      if (row) cell.appendChild(C.sparkline(row.spark));
    });
  }

  function positionsCard(scope) {
    const { rows, total } = positionTable(scope);
    const MIN = 3;
    const ranked = key => rows.filter(r => r[key] && r[key].games >= MIN).sort((a, b) => b[key].ord - a[key].ord);
    const def = ranked('def'), att = ranked('att');
    let h = `<div class="kt-card"><div class="kt-card-head"><h2>Positionen</h2><span class="kt-muted">${total} Spiele mit Positionen</span></div>`;
    if (!def.length && !att.length) {
      h += `<p class="kt-empty">Sobald Spiele mit Abwehr/Sturm eingetragen sind (ab ${MIN} pro Position), erscheinen hier eigene Wertungen für beide Positionen.</p></div>`;
      return h;
    }
    const list = (items, key) => items.length ? `<ol class="kt-poslist">${items.slice(0, 8).map(r =>
      `<li data-player="${esc(r.id)}"><span class="kt-name">${esc(r.name)}</span><span class="kt-num"><strong>${num(r[key].rating)}</strong>
       <span class="kt-muted">${r[key].games} Sp. · ${pct(r[key].wins / r[key].games)}</span></span></li>`).join('')}</ol>`
      : '<p class="kt-empty">Noch zu wenige Spiele.</p>';
    h += `<div class="kt-cols"><div><h3>🛡 Abwehr</h3>${list(def, 'def')}</div><div><h3>⚡ Sturm</h3>${list(att, 'att')}</div></div></div>`;
    return h;
  }

  function explainer() {
    return `<details class="kt-card kt-explain"><summary>Wie funktioniert die Wertung?</summary>
      <p>Die Wertung basiert auf <strong>OpenSkill</strong> (verwandt mit Microsofts TrueSkill), einem System für Teamspiele.
      Für jeden Spieler werden zwei Zahlen geschätzt: die <em>Spielstärke</em> und wie <em>sicher</em> diese Schätzung ist.</p>
      <ul>
        <li><strong>Alle starten bei 1000.</strong> Die Wertung ist die geschätzte Spielstärke. Am Anfang ist das System unsicher,
        deshalb bewegt sie sich stark (ca. ±60 pro Spiel). Mit jedem Spiel wird die Schätzung sicherer und die Sprünge kleiner (ca. ±20).
        In die Rangliste kommt man ab ${PLACEMENT} Spielen.</li>
        <li><strong>Viel spielen bringt keine Punkte.</strong> Wer seltener spielt, wird nicht abgewertet, nur etwas ungenauer geschätzt
        (das ± im Spielerprofil).</li>
        <li><strong>Der Gegner zählt.</strong> Ein Sieg gegen stärkere Teams bringt mehr als gegen schwächere,
        eine Niederlage gegen Favoriten kostet wenig.</li>
        <li><strong>Der Partner zählt.</strong> Wer mit einem starken Partner gewinnt, bekommt weniger als mit einem schwachen.
        Wessen Stärke noch unsicher ist, dessen Wertung bewegt sich stärker.</li>
        <li><strong>Nur Sieg oder Niederlage zählt, nicht das Torverhältnis.</strong> Weil ihr bis 6, bis 10 oder mit Verlängerung spielt,
        wäre ein 6:4 sonst nicht mit einem 10:8 vergleichbar.</li>
        <li><strong>1 gegen 1 und 2 gegen 2</strong> haben getrennte Wertungen. Mit erfassten Positionen gibt es zusätzlich eine
        Abwehr- und eine Sturm-Wertung.</li>
        <li><strong>Saison und ewige Tabelle:</strong> In jeder Saison starten alle wieder bei 1000, die ewige Tabelle läuft über alle Saisons durch.</li>
        <li>Die <strong>Siegchancen</strong> sind an euren bisherigen Ergebnissen geeicht. Kicker ist ziemlich zufällig –
        selbst klare Favoriten liegen selten über 75 %.</li>
      </ul>
      <p class="kt-muted">Alles wird bei jedem Aufruf aus der Spieleliste neu berechnet. Wird ein Spiel gelöscht, stimmen die Wertungen sofort wieder.</p>
    </details>`;
  }

  // ── Spieler-Profil ────────────────────────────────────────────────────────
  function renderPlayer(panel) {
    const st = standings(S.scope, S.mode);
    const rows = st.rows.filter(r => r.games);
    if (!rows.length) { panel.innerHTML = noSeasonHint() || '<div class="kt-card"><p class="kt-empty">Noch keine Spiele.</p></div>'; return; }
    if (!S.player || !rows.find(r => r.id === S.player)) S.player = rows[0].id;
    const me = rows.find(r => r.id === S.player);
    const placedCount = rows.filter(r => r.placed).length;

    let h = `<div class="kt-card kt-card-flat"><label class="kt-select-label">Spieler
      <select data-action="pick-player">${[...rows].sort((a, b) => a.name.localeCompare(b.name, 'de'))
        .map(r => `<option value="${esc(r.id)}" ${r.id === me.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label></div>`;

    h += `<div class="kt-tiles">
      ${tile('Wertung', num(me.rating), (me.placed ? `Platz ${me.rank} von ${placedCount}` : `noch ${PLACEMENT - me.games} Spiele bis zur Platzierung`) + ` · ±${me.spread}`)}
      ${tile('Spiele', me.games, `${me.wins} Siege · ${me.losses} Niederlagen`)}
      ${tile('Siegquote', pct(me.wins / me.games), `Tore ${me.gf}:${me.ga}`)}
      ${tile('Serie', streakText(me.streak), formDots(me.form))}
    </div>`;

    h += `<div class="kt-card"><div class="kt-card-head"><h2>Wertungsverlauf</h2><span class="kt-muted">${esc(me.name)} hervorgehoben, andere grau</span></div>
      <div class="kt-chart-host" id="kt-rating-chart"></div></div>`;

    if (S.mode === 'duo') {
      const pos = positionTable(S.scope).rows.find(r => r.id === me.id);
      if (pos && (pos.def || pos.att)) {
        const side = (lab, x) => x ? tile(lab, num(x.rating), `${x.games} Spiele · ${pct(x.wins / x.games)} Siege`) : tile(lab, '—', 'noch keine Spiele');
        h += `<div class="kt-tiles kt-tiles-2">${side('🛡 Abwehr-Wertung', pos.def)}${side('⚡ Sturm-Wertung', pos.att)}</div>`;
      }
    }

    // Partner & Gegner
    const agg = (keyFn) => {
      const m = new Map();
      me.list.forEach(x => [].concat(keyFn(x)).filter(Boolean).forEach(id => {
        const a = m.get(id) || { id, games: 0, wins: 0, delta: 0, exp: 0 };
        a.games++; if (x.won) a.wins++; a.delta += x.delta; a.exp += x.p;
        m.set(id, a);
      }));
      return [...m.values()].sort((a, b) => b.games - a.games || b.wins / b.games - a.wins / a.games);
    };
    const partners = S.mode === 'duo' ? agg(x => x.partner) : [];
    const opps = agg(x => x.opponents);
    const pick = (list, fn) => { const ok = list.filter(a => a.games >= 5); return ok.length ? ok.reduce((b, a) => fn(a, b) ? a : b) : null; };
    const bestP = pick(partners, (a, b) => a.wins / a.games > b.wins / b.games);
    const favO = pick(opps, (a, b) => a.wins / a.games > b.wins / b.games);
    const fearO = pick(opps, (a, b) => a.wins / a.games < b.wins / b.games);

    const relTable = (list, title, tags, withDelta) => `<div class="kt-card"><h2>${title}</h2>
      <div class="kt-scroll"><table class="kt-table">
      <thead><tr><th>${withDelta ? 'Partner' : 'Gegner'}</th><th class="kt-num">Spiele</th><th>Siegquote</th>${withDelta ? '<th class="kt-num kt-opt">Ø Punkte</th>' : ''}</tr></thead><tbody>
      ${list.map(a => `<tr data-player="${esc(a.id)}" tabindex="0"><td><span class="kt-name">${esc(nameOf(a.id))}</span>${tags(a)}</td>
        <td class="kt-num">${a.games}</td><td class="kt-barcell">${rateBar(a.wins / a.games)}</td>
        ${withDelta ? `<td class="kt-num kt-opt ${deltaClass(Math.round(a.delta / a.games))}">${signed(Math.round(a.delta / a.games))}</td>` : ''}</tr>`).join('')}
      </tbody></table></div></div>`;

    if (partners.length) h += relTable(partners, 'Mit wem läuft es?', a => a === bestP ? ' <span class="kt-tag">Lieblingspartner</span>' : '', true);
    if (opps.length) h += relTable(opps, 'Gegen wen läuft es?', a =>
      (a === favO ? ' <span class="kt-tag">Lieblingsgegner</span>' : '') + (a === fearO && a !== favO ? ' <span class="kt-tag kt-tag-warn">Angstgegner</span>' : ''), false);

    panel.innerHTML = h;
    drawRatingChart(st.rep, me.id);
  }

  function drawRatingChart(rep, playerId) {
    const host = $('#kt-rating-chart');
    if (!host) return;
    const evById = new Map(rep.events.map(e => [e.game.id, e]));
    const series = [...rep.history].map(([id, hist]) => ({
      id, label: nameOf(id),
      points: hist.map(h => ({ x: h.time, y: R.display(h.rating), gameId: h.gameId }))
    }));
    C.lineChart(host, {
      series, highlight: playerId, height: 280,
      ariaLabel: `Wertungsverlauf von ${nameOf(playerId)}`,
      formatX: fmtDay,
      formatTip: p => {
        const e = evById.get(p.gameId);
        const lines = [{ text: `Wertung ${num(p.y)}`, strong: true }];
        if (e) {
          const g = e.game;
          const ti = g.teams[0].includes(playerId) ? 0 : 1;
          const mates = g.teams[ti].filter(x => x !== playerId).map(nameOf);
          lines.push({ text: `${g.winner === ti ? 'Sieg' : 'Niederlage'} ${g.scores[ti]}:${g.scores[1 - ti]} (${signed(e.changes[playerId].delta)})` });
          lines.push({ text: `${mates.length ? 'mit ' + mates.join(' & ') + ' ' : ''}gegen ${g.teams[1 - ti].map(nameOf).join(' & ')}`, muted: true });
          lines.push({ text: `${fmtDate(g.time)}, ${fmtTime(g.time)}`, muted: true });
        }
        return lines;
      }
    });
  }

  // ── Duos ──────────────────────────────────────────────────────────────────
  function renderDuos(panel) {
    const rep = replayFor(S.scope, 'duo');
    const pairs = new Map();
    rep.events.forEach(ev => ev.game.teams.forEach((t, ti) => {
      const key = [...t].sort().join('|');
      const a = pairs.get(key) || { ids: [...t].sort((x, y) => nameOf(x).localeCompare(nameOf(y), 'de')), games: 0, wins: 0, exp: 0 };
      a.games++;
      if (ev.game.winner === ti) a.wins++;
      a.exp += ti === 0 ? ev.pTeam1 : 1 - ev.pTeam1;
      pairs.set(key, a);
    }));
    const all = [...pairs.values()];
    const list = all.filter(a => a.games >= S.duoMin)
      .map(a => ({ ...a, rate: a.wins / a.games, expRate: a.exp / a.games, extra: a.wins - a.exp }))
      .sort((a, b) => b.extra - a.extra);

    let h = noSeasonHint();
    h += `<div class="kt-card"><div class="kt-card-head"><h2>Duos · ${esc(scopeName(S.scope))}</h2>
      <div class="kt-seg kt-seg-sm" role="group" aria-label="Mindestanzahl Spiele">
        ${[3, 5, 10].map(n => `<button data-action="duo-min" data-value="${n}" aria-pressed="${S.duoMin === n}">ab ${n}</button>`).join('')}
      </div></div>
      <p class="kt-sub">Welche Paare gewinnen öfter, als ihre Einzelwertungen erwarten lassen? „Erwartet“ ist die durchschnittliche
      Siegchance vor ihren Spielen, daraus ergibt sich, wie viele Siege mehr oder weniger sie geholt haben. Bei wenigen Spielen ist viel Zufall dabei.</p>`;
    if (!list.length) {
      h += `<p class="kt-empty">Noch kein Duo mit ${S.duoMin} gemeinsamen Spielen.</p>`;
    } else {
      const maxAbs = Math.max(1, ...list.map(a => Math.abs(a.extra)));
      const fmt = x => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(1).replace('.', ',');
      h += `<div class="kt-scroll"><table class="kt-table kt-duos"><thead><tr><th>Duo</th><th class="kt-num">Spiele</th>
        <th class="kt-num">Siege</th><th class="kt-num kt-opt">Erwartet</th><th>Siege über / unter Erwartung</th></tr></thead><tbody>
        ${list.map(a => {
          const w = Math.round(Math.abs(a.extra) / maxAbs * 50);
          return `<tr><td><span class="kt-name">${team(a.ids)}</span></td><td class="kt-num">${a.games}</td>
            <td class="kt-num">${pct(a.rate)}</td><td class="kt-num kt-opt kt-muted">${pct(a.expRate)}</td>
            <td class="kt-divcell"><span class="kt-div"><span class="kt-div-mid"></span>
              <span class="kt-div-fill ${a.extra >= 0 ? 'kt-div-pos' : 'kt-div-neg'}" style="${a.extra >= 0 ? 'left:50%' : `left:${50 - w}%`};width:${w}%"></span></span>
              <span class="kt-bar-val ${deltaClass(a.extra)}">${fmt(a.extra)}</span></td></tr>`;
        }).join('')}</tbody></table></div>`;
    }
    h += `<p class="kt-sub">${all.length} verschiedene Duos haben zusammen gespielt.</p></div>`;
    panel.innerHTML = h;
  }

  // ── Aufstellung / faire Teams ─────────────────────────────────────────────
  function renderLineup(panel) {
    const need = S.mode === 'duo' ? 4 : 2;
    const rep = replayFor(S.scope, S.mode);
    const pos = S.mode === 'duo' ? replayFor(S.scope, 'duo').posRatings : null;
    const posCount = S.mode === 'duo' ? positionTable(S.scope).rows : [];
    const rating = id => rep.ratings.get(id) || R.newRating();
    const active = S.players.filter(p => p.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'de'));
    [...S.lineup].forEach(id => { if (!S.byId.has(id)) S.lineup.delete(id); });

    let h = `<div class="kt-card"><h2>Wer spielt?</h2>
      <p class="kt-sub">Anwesende antippen (mindestens ${need}). Vorgeschlagen werden die ausgeglichensten Paarungen nach Wertung · ${esc(scopeName(S.scope))}.</p>
      <div class="kt-chips">${active.map(p => `<button class="kt-chip" data-action="lineup-toggle" data-id="${esc(p.id)}" aria-pressed="${S.lineup.has(p.id)}">${esc(p.name)}</button>`).join('')}</div>
      ${S.lineup.size ? '<button class="kt-link" data-action="lineup-clear">Auswahl leeren</button>' : ''}</div>`;

    const sel = [...S.lineup];
    if (sel.length >= need) {
      const matches = [];
      const combos = (arr, k, start = 0, acc = [], out = []) => {
        if (acc.length === k) { out.push(acc.slice()); return out; }
        for (let i = start; i < arr.length; i++) { acc.push(arr[i]); combos(arr, k, i + 1, acc, out); acc.pop(); }
        return out;
      };
      combos(sel, need).forEach(q => {
        const splits = need === 2 ? [[[q[0]], [q[1]]]] : [[[q[0], q[1]], [q[2], q[3]]], [[q[0], q[2]], [q[1], q[3]]], [[q[0], q[3]], [q[1], q[2]]]];
        splits.forEach(([a, b]) => matches.push({ a, b, p: R.winProbability(a.map(rating), b.map(rating)) }));
      });
      matches.sort((x, y) => Math.abs(x.p - 0.5) - Math.abs(y.p - 0.5));

      // Positionsvorschlag: wer mit ≥3 Positionsspielen besser hinten bzw. vorne ist
      const posInfo = id => posCount.find(r => r.id === id);
      const suggest = t => {
        if (!pos || t.length !== 2) return '';
        const [x, y] = t;
        const px = posInfo(x), py = posInfo(y);
        if (!px || !py || [px.def, px.att, py.def, py.att].some(s => !s || s.games < 3)) return '';
        const mu = (m, id) => (m.get(id) || R.newRating()).mu;
        const xBack = mu(pos.def, x) + mu(pos.att, y) >= mu(pos.def, y) + mu(pos.att, x);
        const [d, a] = xBack ? [x, y] : [y, x];
        return `<span class="kt-muted kt-possug">🛡 ${esc(nameOf(d))} · ⚡ ${esc(nameOf(a))}</span>`;
      };

      h += `<div class="kt-card"><h2>Fairste Paarungen</h2><ol class="kt-matches">${matches.slice(0, 6).map(m => `
        <li class="kt-match">
          <div class="kt-match-teams"><div><span class="kt-key kt-key-a"></span><strong>${team(m.a)}</strong>${suggest(m.a)}</div>
          <div class="kt-match-vs">gegen</div>
          <div><span class="kt-key kt-key-b"></span><strong>${team(m.b)}</strong>${suggest(m.b)}</div></div>
          <div class="kt-split" aria-label="Siegchance ${pct(m.p)} zu ${pct(1 - m.p)}">
            <span class="kt-split-a" style="width:${(m.p * 100).toFixed(1)}%"></span><span class="kt-split-b"></span></div>
          <div class="kt-split-labels"><span>${pct(m.p)}</span><span>${pct(1 - m.p)}</span></div>
        </li>`).join('')}</ol>
        ${matches.length > 6 ? `<p class="kt-sub">${matches.length} mögliche Paarungen insgesamt.</p>` : ''}</div>`;
    }
    panel.innerHTML = h;
  }

  // ── Spiele ────────────────────────────────────────────────────────────────
  function canDelete(g) {
    if (S.admin) return true;
    return S.user && g.raw.created_by === S.user.id &&
      Date.now() - new Date(g.raw.created_at).getTime() < UNDO_MINUTES * 60e3;
  }

  function renderGames(panel) {
    const rep = replayFor(S.scope, S.mode);
    const evs = rep.events.slice().reverse();
    let h = noSeasonHint();
    h += `<div class="kt-card"><div class="kt-card-head"><h2>Spiele · ${esc(scopeName(S.scope))}</h2><span class="kt-muted">${evs.length} Spiele</span></div>`;
    if (!evs.length) h += '<p class="kt-empty">Noch keine Spiele.</p>';
    let lastDay = null;
    evs.slice(0, S.gamesLimit).forEach(e => {
      const g = e.game;
      const day = dayLabel(g.time);
      if (day !== lastDay) { h += `<h3 class="kt-day">${esc(day)}</h3>`; lastDay = day; }
      const side = ti => {
        const p = ti === 0 ? e.pTeam1 : 1 - e.pTeam1;
        const icons = g.positions ? ['🛡', '⚡'] : ['', ''];
        return `<div class="kt-gside ${g.winner === ti ? 'kt-gwin' : ''} ${ti ? 'kt-gright' : ''}">
          ${g.teams[ti].map((id, i) => `<div class="kt-gplayer"><span class="kt-gname">${icons[i] ? `<span class="kt-posicon" title="${i ? 'Sturm' : 'Abwehr'}">${icons[i]}</span>` : ''}${esc(nameOf(id))}</span>
            <span class="kt-gdelta ${deltaClass(e.changes[id].delta)}">${signed(e.changes[id].delta)}</span></div>`).join('')}
          <div class="kt-gchance">Siegchance ${pct(p)}</div></div>`;
      };
      h += `<div class="kt-game">${side(0)}
        <div class="kt-gscore"><span>${g.scores[0]}</span><span class="kt-muted">:</span><span>${g.scores[1]}</span>
          <div class="kt-gtime">${fmtTime(g.time)}</div>
          ${canDelete(g) ? `<button class="kt-icon-btn" data-action="delete-game" data-id="${esc(g.id)}" title="Spiel löschen" aria-label="Spiel löschen">✕</button>` : ''}</div>
        ${side(1)}</div>`;
    });
    if (evs.length > S.gamesLimit) h += `<button class="kt-btn kt-btn-ghost kt-more" data-action="more-games">Ältere Spiele anzeigen</button>`;
    h += '</div>';
    panel.innerHTML = h;
  }

  // ── Archiv ────────────────────────────────────────────────────────────────
  function renderArchive(panel) {
    const ended = S.seasons.filter(s => !s.is_active)
      .sort((a, b) => new Date(b.ended_at || 0) - new Date(a.ended_at || 0));
    let h = `<div class="kt-card"><h2>Archiv</h2><p class="kt-sub">Abgeschlossene Saisons, neu berechnet aus den gespeicherten Spielen.</p>`;
    if (!ended.length) h += '<p class="kt-empty">Noch keine abgeschlossene Saison.</p>';
    h += '<div class="kt-archive">';
    ended.forEach(s => {
      const st = standings(s.id, S.mode);
      const champ = st.rows.find(r => r.placed) || st.rows[0];
      const n = st.rep.events.length;
      h += `<div class="kt-arch ${S.archive === s.id ? 'kt-arch-open' : ''}">
        <button class="kt-arch-main" data-action="open-season" data-id="${s.id}" aria-expanded="${S.archive === s.id}">
          <strong>${esc(s.name)}</strong>
          <span class="kt-muted">${s.ended_at ? 'bis ' + fmtDate(new Date(s.ended_at)) : ''} · ${n} Spiele</span>
          <span>${champ ? '🏆 ' + esc(champ.name) : ''}</span>
        </button>
        ${S.admin ? `<span class="kt-arch-admin"><button class="kt-icon-btn" data-action="rename-season" data-id="${s.id}" title="Umbenennen" aria-label="Saison umbenennen">✎</button>
          <button class="kt-icon-btn" data-action="delete-season" data-id="${s.id}" title="Löschen" aria-label="Saison löschen">✕</button></span>` : ''}
      </div>`;
      if (S.archive === s.id) h += `<div class="kt-arch-detail" id="kt-arch-detail">${archiveDetail(s, st)}</div>`;
    });
    h += '</div></div>';
    panel.innerHTML = h;
    // Nur wenn zu einer Saison gar keine Spiele mehr existieren, den alten Snapshot zeigen
    if (S.archive != null && !S.games.some(g => g.season_id === S.archive)) loadSnapshots(S.archive);
  }

  function archiveDetail(s, st) {
    if (!st.rows.length) {
      return S.games.some(g => g.season_id === s.id)
        ? `<p class="kt-empty">Keine Spiele im ${S.mode === 'duo' ? '2 gegen 2' : '1 gegen 1'} in dieser Saison.</p>`
        : '<p class="kt-empty">Lädt gespeicherten Endstand …</p>';
    }
    const rows = st.rows;
    const mostWins = rows.reduce((b, r) => (!b || r.wins > b.wins ? r : b), null);
    return `<div class="kt-tiles kt-tiles-3">
        ${tile('Meister', esc((rows.find(r => r.placed) || rows[0]).name))}
        ${tile('Meiste Siege', esc(mostWins.name), `${mostWins.wins} Siege`)}
        ${tile('Spiele', st.rep.events.length)}
      </div>
      <div class="kt-scroll"><table class="kt-table"><thead><tr><th class="kt-num">#</th><th>Spieler</th><th class="kt-num">Wertung</th>
      <th class="kt-num">Spiele</th><th class="kt-num">Siege</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td class="kt-num">${r.rank ?? '–'}</td><td>${esc(r.name)}</td><td class="kt-num"><strong>${num(r.rating)}</strong></td>
        <td class="kt-num">${r.games}</td><td class="kt-num">${pct(r.wins / r.games)}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  // Fallback für Saisons ohne gespeicherte Spiele: alte Snapshot-Endstände
  async function loadSnapshots(seasonId) {
    const { data, error } = await sb.from('season_snapshots').select('*').eq('season_id', seasonId).order('elo_end', { ascending: false });
    const el = $('#kt-arch-detail');
    if (!el || S.archive !== seasonId) return;
    if (error || !data?.length) { el.innerHTML = '<p class="kt-empty">Für diese Saison sind weder Spiele noch ein Endstand gespeichert.</p>'; return; }
    el.innerHTML = `<p class="kt-sub">Keine Spiele mehr vorhanden – gezeigt wird der damals gespeicherte Endstand (alte Elo-Wertung).</p>
      <div class="kt-scroll"><table class="kt-table"><thead><tr><th class="kt-num">#</th><th>Spieler</th><th class="kt-num">Elo</th><th class="kt-num">Spiele</th><th class="kt-num">Siege</th></tr></thead><tbody>
      ${data.map((r, i) => `<tr><td class="kt-num">${i + 1}</td><td>${esc(r.player_name)}</td><td class="kt-num">${r.elo_end}</td><td class="kt-num">${r.games_played}</td><td class="kt-num">${r.wins}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  // ── Eintragen ─────────────────────────────────────────────────────────────
  function renderEntry(panel) {
    if (!S.active) {
      panel.innerHTML = `<div class="kt-card"><p>Es läuft keine Saison, daher können keine Spiele eingetragen werden.${S.admin ? ' Starte im Admin-Bereich eine neue.' : ''}</p></div>`;
      return;
    }
    const E = S.entry;
    const duo = E.mode === 'duo';
    const active = S.players.filter(p => p.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'de'));
    const lab = i => !duo ? 'Spieler' : E.positions ? (i ? '⚡ Sturm' : '🛡 Abwehr') : `Spieler ${i + 1}`;
    const slotSel = (t, i) => {
      const key = `t${t}p${i + 1}`;
      return `<label class="kt-field"><span>${lab(i)}</span><select data-slot="${key}">
        <option value="">– wählen –</option>${active.map(p => `<option value="${esc(p.id)}" ${E.slots[key] === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select></label>`;
    };
    const teamBox = t => `<fieldset class="kt-team"><legend>Team ${t}</legend>
      ${slotSel(t, 0)}${duo ? slotSel(t, 1) : ''}
      <label class="kt-field"><span>Tore</span><input type="number" inputmode="numeric" min="0" max="99" data-score="${t}" value="${E['s' + t] ?? ''}"></label>
    </fieldset>`;

    panel.innerHTML = `<div class="kt-card"><div class="kt-card-head"><h2>Spiel eintragen</h2><span class="kt-muted">Saison „${esc(S.active.name)}“</span></div>
      <div class="kt-entry-opts">
        <div class="kt-seg" role="group" aria-label="Spielmodus">
          <button data-action="entry-mode" data-value="duo" aria-pressed="${duo}">2 gegen 2</button>
          <button data-action="entry-mode" data-value="solo" aria-pressed="${!duo}">1 gegen 1</button>
        </div>
        ${duo ? `<label class="kt-check"><input type="checkbox" data-action="entry-pos" ${E.positions ? 'checked' : ''}> Positionen erfassen (Abwehr/Sturm)</label>` : ''}
      </div>
      ${duo && !E.positions ? '<p class="kt-sub">Ohne Positionen zählt das Spiel nur für die normale Wertung – z.B. wenn ihr während des Spiels gewechselt habt.</p>' : ''}
      <form class="kt-entry" data-form="entry" novalidate>
        <div class="kt-teams">${teamBox(1)}${teamBox(2)}</div>
        <div class="kt-pred" id="kt-pred"></div>
        <p class="kt-form-error" id="kt-entry-error" role="alert"></p>
        <button type="submit" class="kt-btn kt-btn-primary">Spiel speichern</button>
      </form></div>`;
    updatePrediction();
  }

  function entrySlots() {
    const duo = S.entry.mode === 'duo';
    const s = S.entry.slots;
    return { duo, t1: [s.t1p1, duo ? s.t1p2 : null], t2: [s.t2p1, duo ? s.t2p2 : null] };
  }

  function updatePrediction() {
    const box = $('#kt-pred');
    if (!box) return;
    const { duo, t1, t2 } = entrySlots();
    const a = t1.filter(Boolean), b = t2.filter(Boolean);
    const need = duo ? 2 : 1;
    if (a.length < need || b.length < need || new Set([...a, ...b]).size !== a.length + b.length) { box.innerHTML = ''; return; }
    const rep = replayFor('season', S.entry.mode);
    const r = id => rep.ratings.get(id) || R.newRating();
    const p = R.winProbability(a.map(r), b.map(r));
    box.innerHTML = `<div class="kt-split"><span class="kt-split-a" style="width:${(p * 100).toFixed(1)}%"></span><span class="kt-split-b"></span></div>
      <div class="kt-split-labels"><span>Team 1 · ${pct(p)}</span><span>${pct(1 - p)} · Team 2</span></div>`;
  }

  async function submitEntry(form) {
    const err = $('#kt-entry-error');
    err.textContent = '';
    const { duo, t1, t2 } = entrySlots();
    const s1 = parseInt(S.entry.s1, 10), s2 = parseInt(S.entry.s2, 10);
    const ids = [...t1, ...t2].filter(Boolean);
    const fail = msg => { err.textContent = msg; };
    if (ids.length !== (duo ? 4 : 2)) return fail('Bitte alle Spieler auswählen.');
    if (new Set(ids).size !== ids.length) return fail('Jeder Spieler darf nur einmal vorkommen.');
    if (!Number.isInteger(s1) || !Number.isInteger(s2) || s1 < 0 || s2 < 0) return fail('Bitte beide Torzahlen eintragen.');
    if (s1 === s2) return fail('Unentschieden gibt es nicht – bitte das Endergebnis eintragen.');

    const row = {
      team1_player1: t1[0], team1_player2: t1[1] || null,
      team2_player1: t2[0], team2_player2: t2[1] || null,
      score_team1: s1, score_team2: s2,
      season_id: S.active.id, archived: false,
      positions_known: duo && S.entry.positions
    };
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    const { data, error } = await sb.from('games').insert([row]).select().single();
    btn.disabled = false;
    if (error) return fail('Speichern fehlgeschlagen: ' + error.message);

    S.games.push(data);
    cache.clear();
    S.entry.s1 = S.entry.s2 = '';
    const ev = replayFor('season', duo ? 'duo' : 'solo').events.find(e => e.game.id === data.id);
    const summary = ev ? ids.map(id => `${nameOf(id)} ${signed(ev.changes[id].delta)}`).join(' · ') : '';
    render();
    toast(`Gespeichert. ${summary}`, { label: 'Rückgängig', run: () => deleteGame(data.id, true) });
  }

  // ── Admin ─────────────────────────────────────────────────────────────────
  function renderAdmin(panel) {
    const counts = new Map();
    S.games.forEach(g => [g.team1_player1, g.team1_player2, g.team2_player1, g.team2_player2].filter(Boolean)
      .forEach(id => counts.set(id, (counts.get(id) || 0) + 1)));
    const players = [...S.players].sort((a, b) => (b.active !== false) - (a.active !== false) || a.name.localeCompare(b.name, 'de'));

    panel.innerHTML = `<div class="kt-card"><h2>Spieler</h2>
      <p class="kt-sub">Inaktive Spieler tauchen nicht mehr in der Auswahl beim Eintragen auf, ihre Spiele bleiben erhalten.
      Löschen geht nur bei Spielern ohne Spiele.</p>
      <div class="kt-scroll"><table class="kt-table kt-admin-players"><thead><tr><th>Name</th><th class="kt-num">Spiele</th><th>Aktiv</th><th></th></tr></thead><tbody>
      ${players.map(p => `<tr><td><input class="kt-input" data-rename="${esc(p.id)}" value="${esc(p.name)}" aria-label="Name"></td>
        <td class="kt-num">${counts.get(p.id) || 0}</td>
        <td><input type="checkbox" data-action="player-active" data-id="${esc(p.id)}" ${p.active !== false ? 'checked' : ''} aria-label="aktiv"></td>
        <td>${counts.get(p.id) ? '' : `<button class="kt-icon-btn" data-action="delete-player" data-id="${esc(p.id)}" aria-label="Spieler löschen" title="Löschen">✕</button>`}</td></tr>`).join('')}
      </tbody></table></div>
      <form class="kt-inline-form" data-form="add-player"><input class="kt-input" name="name" placeholder="Neuer Spieler" required maxlength="40">
        <button class="kt-btn kt-btn-primary" type="submit">Hinzufügen</button></form></div>

      <div class="kt-card"><h2>Saison</h2>
      ${S.active ? `<p>Aktuell: <strong>${esc(S.active.name)}</strong> · ${gamesIn('season').length} Spiele · seit ${fmtDate(new Date(S.active.started_at || S.active.archived_at || Date.now()))}</p>
        <p class="kt-sub">Beendet die Saison, speichert den Endstand im Archiv und startet eine neue. Alle beginnen in der neuen Saison bei 1000;
        die ewige Tabelle läuft weiter.</p>
        <button class="kt-btn kt-btn-danger" data-action="end-season">Saison beenden & neue starten</button>`
      : `<p>Keine aktive Saison.</p><button class="kt-btn kt-btn-primary" data-action="start-season">Neue Saison starten</button>`}
      </div>`;
  }

  async function endSeason() {
    if (!S.active) return;
    if (!confirm(`Saison „${S.active.name}“ wirklich beenden? Das lässt sich nicht rückgängig machen.`)) return;
    const next = prompt('Name der neuen Saison:', `Saison ${S.seasons.length + 1}`);
    if (!next || !next.trim()) return;
    const rows = standings('season', 'duo').rows;
    if (rows.length) {
      const { error } = await sb.from('season_snapshots').insert(rows.map(r => ({
        season_id: S.active.id, player_id: r.id, player_name: r.name, elo_end: r.rating, games_played: r.games, wins: r.wins
      })));
      if (error) return alert('Endstand konnte nicht gespeichert werden: ' + error.message);
    }
    const { error: e1 } = await sb.from('seasons').update({ is_active: false, ended_at: new Date().toISOString() }).eq('id', S.active.id);
    if (e1) return alert('Saison konnte nicht beendet werden: ' + e1.message);
    await startSeason(next.trim(), true);
  }

  async function startSeason(name, silent) {
    if (!name) {
      name = prompt('Name der neuen Saison:', `Saison ${S.seasons.length + 1}`);
      if (!name || !name.trim()) return;
      name = name.trim();
    }
    const { error } = await sb.from('seasons').insert([{ name, is_active: true, started_at: new Date().toISOString() }]);
    if (error) return alert('Saison konnte nicht angelegt werden: ' + error.message);
    await loadData();
    render();
    toast(silent ? `Saison beendet. „${name}“ läuft.` : `Saison „${name}“ gestartet.`);
  }

  async function deleteGame(id, undo) {
    if (!undo && !confirm('Spiel löschen? Die Wertungen werden danach automatisch neu berechnet.')) return;
    const { error, count } = await sb.from('games').delete({ count: 'exact' }).eq('id', id);
    if (error || count === 0) return toast('Löschen nicht möglich' + (error ? ': ' + error.message : ' – eigene Spiele nur 15 Minuten lang.'));
    S.games = S.games.filter(g => g.id !== id);
    cache.clear();
    render();
    toast(undo ? 'Eintrag zurückgenommen.' : 'Spiel gelöscht.');
  }

  // ── Login ─────────────────────────────────────────────────────────────────
  function renderLogin(panel) {
    if (S.user) { panel.innerHTML = '<div class="kt-card"><p>Du bist angemeldet.</p></div>'; return; }
    panel.innerHTML = `<div class="kt-card kt-login"><h2>Anmelden</h2>
      <p class="kt-sub">Zum Eintragen von Spielen. Ansehen geht ohne Anmeldung.</p>
      <form data-form="login">
        <label class="kt-field"><span>E-Mail</span><input class="kt-input" type="email" name="email" autocomplete="username" required></label>
        <label class="kt-field"><span>Passwort</span><input class="kt-input" type="password" name="password" autocomplete="current-password" required></label>
        <p class="kt-form-error" id="kt-login-error" role="alert"></p>
        <button class="kt-btn kt-btn-primary" type="submit">Anmelden</button>
      </form></div>`;
  }

  // ── Toast ─────────────────────────────────────────────────────────────────
  let toastTimer = null;
  function toast(text, action) {
    const el = $('#kt-toast');
    el.textContent = '';
    const span = document.createElement('span');
    span.textContent = text;
    el.appendChild(span);
    if (action) {
      const b = document.createElement('button');
      b.className = 'kt-link';
      b.textContent = action.label;
      b.addEventListener('click', () => { el.hidden = true; action.run(); });
      el.appendChild(b);
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, action ? 12000 : 4000);
  }

  // ── Events ────────────────────────────────────────────────────────────────
  function openPlayer(id) { S.player = id; setTab('player'); }

  async function onClick(e) {
    const t = e.target.closest('[data-tab],[data-filter] button,[data-action],[data-player]');
    if (!t || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && t.type !== 'checkbox')) return;
    if (t.dataset.tab) return setTab(t.dataset.tab);
    const group = t.closest('[data-filter]');
    if (group && t.dataset.value) {
      S[group.dataset.filter] = t.dataset.value;
      return render();
    }
    const a = t.dataset.action;
    const id = t.dataset.id;
    switch (a) {
      case 'logout': await sb.auth.signOut(); await refreshAuth(); S.tab = 'rank'; render(); return;
      case 'duo-min': S.duoMin = Number(t.dataset.value); return render();
      case 'lineup-toggle': S.lineup.has(id) ? S.lineup.delete(id) : S.lineup.add(id); return render();
      case 'lineup-clear': S.lineup.clear(); return render();
      case 'more-games': S.gamesLimit += 60; return render();
      case 'delete-game': return deleteGame(id);
      case 'open-season': S.archive = S.archive === Number(id) ? null : Number(id); return render();
      case 'rename-season': {
        const s = seasonById(Number(id));
        const name = prompt('Neuer Name:', s?.name || '');
        if (!name || !name.trim() || name.trim() === s?.name) return;
        const { error } = await sb.from('seasons').update({ name: name.trim() }).eq('id', s.id);
        if (error) return alert(error.message);
        s.name = name.trim(); return render();
      }
      case 'delete-season': {
        const s = seasonById(Number(id));
        if (!s || s.is_active) return;
        if (!confirm(`Saison „${s.name}“ aus dem Archiv löschen? Die Spiele bleiben in der ewigen Tabelle erhalten.`)) return;
        let r = await sb.from('season_snapshots').delete().eq('season_id', s.id);
        if (!r.error) r = await sb.from('games').update({ season_id: null }).eq('season_id', s.id);
        if (!r.error) r = await sb.from('seasons').delete().eq('id', s.id);
        if (r.error) return alert('Löschen fehlgeschlagen: ' + r.error.message);
        S.archive = null; await loadData(); return render();
      }
      case 'entry-mode': S.entry.mode = t.dataset.value; return render();
      case 'entry-pos': S.entry.positions = t.checked; return render();
      case 'end-season': return endSeason();
      case 'start-season': return startSeason();
      case 'player-active': {
        const { error } = await sb.from('players').update({ active: t.checked }).eq('id', id);
        if (error) { t.checked = !t.checked; return alert(error.message); }
        S.byId.get(id).active = t.checked; return;
      }
      case 'delete-player': {
        if (!confirm(`„${nameOf(id)}“ löschen?`)) return;
        const { error } = await sb.from('players').delete().eq('id', id);
        if (error) return alert(error.message);
        await loadData(); return render();
      }
    }
    if (t.dataset.player && !a) openPlayer(t.dataset.player);
  }

  function onChange(e) {
    const t = e.target;
    if (t.dataset.action === 'pick-player') { S.player = t.value; return render(); }
    if (t.dataset.slot) { S.entry.slots[t.dataset.slot] = t.value || null; return updatePrediction(); }
    if (t.dataset.rename) renamePlayer(t.dataset.rename, t.value);
  }

  function onInput(e) {
    const t = e.target;
    if (t.dataset.score) S.entry['s' + t.dataset.score] = t.value;
  }

  async function renamePlayer(id, name) {
    name = name.trim();
    const p = S.byId.get(id);
    if (!p || !name || name === p.name) return;
    const { error } = await sb.from('players').update({ name }).eq('id', id);
    if (error) return alert(error.message);
    p.name = name;
    cache.clear();
    toast(`Umbenannt in „${name}“.`);
  }

  async function onSubmit(e) {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const kind = form.dataset.form;
    if (kind === 'entry') return submitEntry(form);
    if (kind === 'login') {
      const fd = new FormData(form);
      const { error } = await sb.auth.signInWithPassword({ email: String(fd.get('email')).trim(), password: String(fd.get('password')) });
      if (error) { $('#kt-login-error').textContent = 'E-Mail oder Passwort falsch.'; return; }
      await refreshAuth();
      setTab('entry');
      return;
    }
    if (kind === 'add-player') {
      const name = String(new FormData(form).get('name')).trim();
      if (!name) return;
      if (S.players.some(p => p.name.toLowerCase() === name.toLowerCase())) return alert('Den Namen gibt es schon.');
      // elo/games_played/elo_start: Altspalten aus v1, falls sie NOT NULL ohne Default sind
      const { error } = await sb.from('players').insert([{ name, elo: 1000, games_played: 0, elo_start: 1000 }]);
      if (error) return alert(error.message);
      await loadData(); render();
    }
  }

  function onKey(e) {
    if (e.key === 'Enter' && e.target.matches('tr[data-player]')) openPlayer(e.target.dataset.player);
  }

  // Live-Updates: neue/gelöschte Spiele anderer Geräte
  let reloadTimer = null;
  function subscribe() {
    sb.channel('kicker-games')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, () => {
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(reloadGames, 600);
      })
      .subscribe();
  }

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (S.tab === 'player') render(); }, 200);
  });

  // ── Start ─────────────────────────────────────────────────────────────────
  (async function init() {
    const root = $('#kt');
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
    root.addEventListener('submit', onSubmit);
    root.addEventListener('keydown', onKey);

    const fromHash = Object.keys(TABS).find(k => '#' + TABS[k] === location.hash);
    if (fromHash) S.tab = fromHash;
    render();
    await Promise.all([refreshAuth(), loadData()]);
    render();
    subscribe();
  })();
})();
