// Reine Logik des Mensa-Rankings (assets/mensa/logic.js). Start: node --test _tests
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const L = require('../../assets/mensa/logic.js');

const dishes = [
  { id: 1, name: 'Käsespätzle' },
  { id: 2, name: 'Käsespätzle mit Röstzwiebeln' },
  { id: 3, name: 'Linsensuppe' },
  { id: 4, name: 'Chili sin Carne' },
  { id: 5, name: 'Spaghetti Bolognese' }
];

test('nameKey: nur Schreibweise zählt, nicht Bedeutung', () => {
  assert.equal(L.nameKey('  Käsespätzle!! '), 'kaesespaetzle');
  assert.equal(L.nameKey('KAESESPAETZLE'), 'kaesespaetzle');
  assert.equal(L.nameKey('Grießbrei'), L.nameKey('GRIESSBREI'));
  assert.equal(L.nameKey('Crème brûlée'), 'creme brulee');
  // NFD-Umlaut (a + Trema) wie NFC-Umlaut
  assert.equal(L.nameKey('Käse'), L.nameKey('Käse'));
  assert.notEqual(L.nameKey('Käsespätzle'), L.nameKey('Käsespätzle mit Röstzwiebeln'));
  assert.equal(L.nameKey('   '), '');
});

test('Vorschläge: Präfix und Tippfehler finden, exakt markieren', () => {
  const s = L.suggest('käse', dishes);
  assert.deepEqual(s.map(x => x.dish.id), [1, 2]);
  assert.ok(!s[0].exact);
  const exact = L.suggest('kaesespaetzle', dishes);
  assert.equal(exact[0].dish.id, 1);
  assert.ok(exact[0].exact);
  assert.equal(L.suggest('Linsnsuppe', dishes)[0].dish.id, 3); // Tippfehler
  assert.equal(L.suggest('spag bolo', dishes)[0].dish.id, 5);   // Wortanfänge
  assert.deepEqual(L.suggest('k', dishes), []);                 // zu kurz
  assert.deepEqual(L.suggest('Tiramisu', dishes), []);          // nichts Ähnliches
});

test('Vorschläge: Beliebtheit entscheidet bei gleicher Ähnlichkeit', () => {
  const pop = d => (d.id === 2 ? 10 : 0);
  const s = L.suggest('Käsesp', dishes, { popularity: pop });
  assert.equal(s[0].dish.id, 2);
});

test('Zuordnung: nur exakt gleicher Schlüssel, ähnliche Namen nur als Rückfrage', () => {
  assert.equal(L.findExact('käsespätzle ', dishes).id, 1);
  assert.equal(L.findExact('Käsespätzle mit Zwiebeln', dishes), null);
  const sim = L.similarDishes('Käsespätzle mit Zwiebeln', dishes);
  assert.ok(sim.some(x => x.dish.id === 1), 'ähnliches Gericht wird angeboten');
  assert.ok(sim.every(x => !x.exact));
  assert.deepEqual(L.similarDishes('Tiramisu', dishes), []);
});

test('Suche im Verlauf', () => {
  assert.ok(L.matchesSearch('spätzle', 'Käsespätzle mit Röstzwiebeln'));
  assert.ok(L.matchesSearch('röst käse', 'Käsespätzle mit Röstzwiebeln'));
  assert.ok(!L.matchesSearch('linsen', 'Käsespätzle'));
  assert.ok(L.matchesSearch('', 'egal'));
});

test('Bewertung: keine Stimme ist „Noch nicht bewertet“, nicht 0/10', () => {
  const none = L.summarize(undefined);
  assert.equal(none.votes, 0);
  assert.equal(none.avg, null);
  assert.equal(L.scoreText(none), 'Noch nicht bewertet');
  const one = L.summarize({ votes: 1, rating_sum: 10 });
  assert.equal(L.scoreText(one), 'Ø 10,0 · 1 Stimme');
  assert.ok(one.few, 'eine einzelne 10 gilt als „wenige Stimmen“');
  const many = L.summarize({ votes: 4, rating_sum: 29, filling_medium: 3, filling_heavy: 1 });
  assert.equal(L.scoreText(many), 'Ø 7,3 · 4 Stimmen');
  assert.ok(!many.few);
  assert.equal(L.fillingText(many), 'meist sättigend (3 von 4)');
  assert.equal(L.fillingText(one), null);
  assert.equal(L.fillingText(L.summarize({ votes: 2, rating_sum: 10, filling_light: 1, filling_heavy: 1 })),
    'meist eher leicht / sehr sättigend (je 1)');
});

test('Zusammenfassen mehrerer Ausgaben ist nach Stimmen gewichtet', () => {
  const a = L.summarize({ votes: 1, rating_sum: 10 });
  const b = L.summarize({ votes: 3, rating_sum: 12 });
  const c = L.combine([a, b]);
  assert.equal(c.votes, 4);
  assert.equal(c.avg, 22 / 4); // nicht (10 + 4) / 2
  assert.equal(c.servings, 2);
  assert.equal(L.combine([]).avg, null);
});

test('Historie: nur frühere Tage desselben Gerichts, heute getrennt', () => {
  const servings = [
    { id: 10, dish_id: 1, served_on: '2026-09-01' },
    { id: 11, dish_id: 1, served_on: '2026-09-15' },
    { id: 12, dish_id: 1, served_on: '2026-09-25' }, // heute
    { id: 13, dish_id: 3, served_on: '2026-09-10' }
  ];
  const stats = { 10: { votes: 2, rating_sum: 14 }, 11: { votes: 1, rating_sum: 4 }, 12: { votes: 5, rating_sum: 50 } };
  const statsOf = id => L.summarize(stats[id]);
  const h = L.dishHistory(servings[2], servings, statsOf);
  assert.equal(h.servings, 2);
  assert.equal(h.votes, 3);
  assert.equal(h.avg, 6);
  assert.equal(h.last, '2026-09-15');
  const first = L.dishHistory(servings[0], servings, statsOf);
  assert.equal(first.servings, 0);
});

test('Bestenliste: einzelne 10/10 überholt keinen belastbaren Schnitt', () => {
  const servings = [
    { id: 1, dish_id: 1, served_on: '2026-09-01' },
    { id: 2, dish_id: 3, served_on: '2026-09-02' },
    { id: 3, dish_id: 4, served_on: '2026-09-03' },
    { id: 4, dish_id: 5, served_on: '2026-09-04' }
  ];
  const stats = {
    1: { votes: 1, rating_sum: 10 },  // eine 10
    2: { votes: 5, rating_sum: 40 },  // Ø 8 aus 5
    3: { votes: 3, rating_sum: 18 }   // Ø 6 aus 3
  };
  const r = L.rankDishes(dishes, servings, id => L.summarize(stats[id]));
  assert.deepEqual(r.map(x => x.dish.id), [3, 4, 1, 5]);
  assert.ok(r[2].few);
  assert.equal(r[3].votes, 0);
});

test('Datum: lokal statt UTC, verständliche Labels', () => {
  assert.equal(L.isoDate(new Date(2026, 8, 25, 23, 30)), '2026-09-25'); // spätabends nicht schon morgen
  assert.equal(L.addDays('2026-09-01', -1), '2026-08-31');
  assert.equal(L.dayLabel('2026-09-25', '2026-09-25'), 'Heute');
  assert.equal(L.dayLabel('2026-09-24', '2026-09-25'), 'Gestern');
  assert.match(L.dayLabel('2026-09-22', '2026-09-25'), /22\.09\./);
  assert.match(L.dayLabel('2025-12-31', '2026-01-05'), /2025/);
});

test('Speiseplan: Kürzel weg, Hinweise bleiben, keine Doppelten', () => {
  const meals = [
    { name: 'Kichererbseneintopf mit Gemüse, dazu ein Stück Obst (vegan,3,Se)\n', category: 'D', prices: { students: 2.9 } },
    { name: 'Schlemmerbuffet (je 100g)\nReichhaltige Auswahl …\n', category: 'A+B', prices: { students: 0.99 } },
    { name: 'Tagessuppe\n', category: 'A+B', prices: { students: 0.6 } },
    { name: 'Tagessuppe', category: 'A+B', prices: { students: 0.6 } },
    { name: '\n', prices: {} }
  ];
  assert.deepEqual(L.parseMenu(meals), [
    { name: 'Kichererbseneintopf mit Gemüse, dazu ein Stück Obst', category: 'D' },
    { name: 'Schlemmerbuffet (je 100g)', category: 'A+B' },
    { name: 'Tagessuppe', category: 'A+B' }
  ]);
  assert.equal(L.cleanMenuName('Hähnchen (2,3) mit Reis (GlWe)'), 'Hähnchen mit Reis');
  assert.deepEqual(L.parseMenu(null), []);
});

test('Fotos: nie vergrößern, Pfade im eigenen Ordner', () => {
  assert.deepEqual(L.fitSize(4032, 3024, 1280), { w: 1280, h: 960 });
  assert.deepEqual(L.fitSize(3024, 4032, 1280), { w: 960, h: 1280 });
  assert.deepEqual(L.fitSize(800, 600, 1280), { w: 800, h: 600 });
  assert.deepEqual(L.photoPaths('u1', 42, 'ab12'), { photo: 'u1/42-ab12.jpg', thumb: 'u1/42-ab12-t.jpg' });
});
