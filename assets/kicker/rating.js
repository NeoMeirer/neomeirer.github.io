/*
 * Kicker-Ticker Wertungs-Engine
 *
 * OpenSkill (Weng-Lin, Plackett-Luce-Modell) für Zwei-Team-Spiele ohne Unentschieden.
 * Die Updates sind identisch zu openskill.js `rate(teams, { tau: 0.2 })` (sonst Standardparameter);
 * gegen die Bibliothek über alle bisherigen Spiele auf 1e-14 genau verifiziert.
 *
 * Jeder Spieler hat μ (geschätzte Spielstärke) und σ (Unsicherheit dieser Schätzung).
 * Angezeigt und sortiert wird μ auf Elo-ähnlicher Skala (Start 1000). σ bestimmt, wie stark sich
 * die Wertung pro Spiel bewegt. Bewusst NICHT die übliche konservative Wertung μ − 3σ: Die schrumpft
 * bei Teamspielen so langsam, dass selbst nach 100 Spielen noch ~500 Punkte „Unsicherheitsabzug"
 * übrig wären – wer weniger spielt, stünde dann allein deshalb deutlich tiefer.
 * Gegen Zufallstreffer mit wenigen Spielen hilft stattdessen eine Mindestanzahl Spiele (in app.js).
 *
 * Die Wertung wird nie gespeichert, sondern immer aus der Spieleliste berechnet.
 * Dadurch gibt es genau eine Wahrheit (die Spiele), Löschen/Korrigieren eines Spiels
 * ist automatisch konsistent und niemand kann Wertungen direkt manipulieren.
 */
(function (root) {
  'use strict';

  const MU = 25;
  const SIGMA = MU / 3;
  const BETA = SIGMA / 2;
  const BETA_SQ = BETA * BETA;
  const TAU = 0.2;           // Dynamik: σ wächst pro Spiel leicht, damit Wertungen beweglich bleiben
  // Kicker ist zufälliger als das Modell annimmt: Für Siegchancen wird die Leistungsstreuung
  // pro Spieler größer angesetzt. Wert per Log-Loss an den echten Spielen (Apr–Jul 2026) kalibriert.
  const PRED_BETA = 14;
  const EPSILON = 1e-4;
  const Z = 3;
  const SCALE = 40;          // Anzeige: Wertung = 1000 + 40 · (μ − 25)
  const BASE = 1000;

  const newRating = () => ({ mu: MU, sigma: SIGMA });
  const ordinal = r => r.mu - Z * r.sigma;
  const display = r => Math.round(BASE + SCALE * (r.mu - MU));
  const spread = r => Math.round(SCALE * r.sigma);   // ± Unsicherheit in Wertungspunkten

  // Plackett-Luce für genau zwei Teams, winner = Index des Siegerteams (0 oder 1).
  // teams: [[{mu, sigma}, ...], [{mu, sigma}, ...]] → gleiche Form mit neuen Werten.
  function rateTwoTeams(teams, winner) {
    const tauSq = TAU * TAU;
    const pre = teams.map(t => t.map(p => ({ mu: p.mu, sigma: Math.sqrt(p.sigma * p.sigma + tauSq) })));
    const tMu = pre.map(t => t.reduce((s, p) => s + p.mu, 0));
    const tSq = pre.map(t => t.reduce((s, p) => s + p.sigma * p.sigma, 0));
    const c = Math.sqrt(tSq[0] + tSq[1] + 2 * BETA_SQ);
    const e = tMu.map(m => Math.exp(m / c));
    const loser = 1 - winner;
    // P(Sieger schlägt Verlierer) nach Modell
    const pWin = e[winner] / (e[winner] + e[loser]);

    return pre.map((team, i) => {
      // Sieger: Summe nur über sich selbst (sumQ = e_w + e_l).
      // Verlierer: Summe über Sieger-Menge (sumQ = e_w + e_l) und sich selbst (sumQ = e_l).
      let omega, delta;
      if (i === winner) {
        omega = 1 - pWin;
        delta = pWin * (1 - pWin);
      } else {
        const q = e[i] / (e[winner] + e[loser]);
        omega = -q;            // gegen die Sieger-Menge
        delta = q * (1 - q);
        // Term gegen sich selbst: quotient = 1 → (1 − 1) = 0, Beitrag 0
      }
      const gamma = Math.sqrt(tSq[i]) / c;
      const iOmega = omega * (tSq[i] / c);
      const iDelta = gamma * delta * (tSq[i] / (c * c));
      return team.map(p => {
        const share = (p.sigma * p.sigma) / tSq[i];
        return {
          mu: p.mu + share * iOmega,
          sigma: p.sigma * Math.sqrt(Math.max(1 - share * iDelta, EPSILON))
        };
      });
    });
  }

  // Gewinnwahrscheinlichkeit Team A gegen Team B (TrueSkill-Formel, Streuung pro Spieler)
  function winProbability(teamA, teamB) {
    const muA = teamA.reduce((s, p) => s + p.mu, 0);
    const muB = teamB.reduce((s, p) => s + p.mu, 0);
    const sqA = teamA.reduce((s, p) => s + p.sigma * p.sigma, 0);
    const sqB = teamB.reduce((s, p) => s + p.sigma * p.sigma, 0);
    const n = teamA.length + teamB.length;
    return phi((muA - muB) / Math.sqrt(n * PRED_BETA * PRED_BETA + sqA + sqB));
  }

  // Standardnormal-CDF (Abramowitz/Stegun 7.1.26, Fehler < 1.5e-7)
  function phi(x) {
    const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
    return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
  }

  // ── Spiel-Normalisierung ──────────────────────────────────────────────────
  // Konvention: Bei positions_known = true ist player1 = Abwehr, player2 = Sturm.
  function modeOf(g) {
    const a = [g.team1_player1, g.team1_player2].filter(Boolean).length;
    const b = [g.team2_player1, g.team2_player2].filter(Boolean).length;
    if (a === 2 && b === 2) return 'duo';
    if (a === 1 && b === 1) return 'solo';
    return null;
  }

  function normalize(g) {
    const mode = modeOf(g);
    const t1 = [g.team1_player1, g.team1_player2].filter(Boolean);
    const t2 = [g.team2_player1, g.team2_player2].filter(Boolean);
    return {
      raw: g,
      id: g.id,
      mode,
      seasonId: g.season_id,
      time: new Date(g.played_at).getTime(),
      teams: [t1, t2],
      scores: [g.score_team1, g.score_team2],
      winner: g.score_team1 > g.score_team2 ? 0 : 1,
      positions: mode === 'duo' && g.positions_known === true
    };
  }

  function sortGames(games) {
    return games.slice().sort((a, b) =>
      (new Date(a.played_at) - new Date(b.played_at)) || String(a.id).localeCompare(String(b.id)));
  }

  /*
   * Spielt eine Menge Spiele chronologisch durch und liefert:
   *  - ratings:  Map playerId → {mu, sigma}  (für 'duo' bzw. 'solo')
   *  - posRatings: { def: Map, att: Map }    (nur aus 2v2-Spielen mit erfassten Positionen)
   *  - events:   pro Spiel die Wertungsänderung jedes Spielers + Vorhersage vor dem Spiel
   *  - history:  Map playerId → [{time, gameId, rating}] (nach jedem eigenen Spiel)
   */
  function replay(rawGames, mode) {
    const ratings = new Map();
    const pos = { def: new Map(), att: new Map() };
    const history = new Map();
    const events = [];
    const get = (m, id) => { if (!m.has(id)) m.set(id, newRating()); return m.get(id); };

    for (const raw of sortGames(rawGames)) {
      const g = normalize(raw);
      if (g.mode !== mode || !Number.isFinite(g.time) || g.scores[0] === g.scores[1]) continue;

      const before = g.teams.map(t => t.map(id => ({ ...get(ratings, id) })));
      const pTeam1 = winProbability(before[0], before[1]);
      const after = rateTwoTeams(before, g.winner);
      const changes = {};
      g.teams.forEach((t, ti) => t.forEach((id, pi) => {
        ratings.set(id, after[ti][pi]);
        changes[id] = { before: before[ti][pi], after: after[ti][pi], delta: display(after[ti][pi]) - display(before[ti][pi]) };
        if (!history.has(id)) history.set(id, []);
        history.get(id).push({ time: g.time, gameId: g.id, rating: after[ti][pi] });
      }));

      if (g.positions) {
        // Team = [Abwehr-Wertung des Abwehrspielers, Sturm-Wertung des Stürmers]
        const pb = g.teams.map(([d, a]) => [{ ...get(pos.def, d) }, { ...get(pos.att, a) }]);
        const pa = rateTwoTeams(pb, g.winner);
        g.teams.forEach(([d, a], ti) => { pos.def.set(d, pa[ti][0]); pos.att.set(a, pa[ti][1]); });
      }

      events.push({ game: g, pTeam1, changes });
    }
    return { ratings, posRatings: pos, events, history };
  }

  const api = { MU, SIGMA, BETA, TAU, PRED_BETA, SCALE, BASE, newRating, ordinal, display, spread, rateTwoTeams, winProbability, modeOf, normalize, sortGames, replay };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KickerRating = api;
})(typeof window !== 'undefined' ? window : globalThis);
