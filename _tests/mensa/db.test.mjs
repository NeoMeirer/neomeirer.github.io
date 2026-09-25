// Migration + Zugriffsregeln des Mensa-Rankings gegen echtes Postgres (PGlite, WASM).
// Start:  cd _tests && npm install && npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const root = new URL('../../', import.meta.url);
const read = p => readFile(new URL(p, root), 'utf8');

let PGlite;
try {
  ({ PGlite } = await import('@electric-sql/pglite'));
} catch {
  PGlite = null;
}
const skip = PGlite ? false : 'PGlite fehlt – vorher `npm install` in _tests ausführen';

let db;
before(async () => {
  if (!PGlite) return;
  db = new PGlite();
  await db.exec(await read('_tests/mensa/supabase_stub.sql'));
});

async function runChecks() {
  const sql = await read('_supabase/mensa_v1_checks.sql');
  await assert.rejects(db.exec(sql), err => {
    assert.match(err.message, /MENSA-CHECKS BESTANDEN/, err.message);
    assert.doesNotMatch(err.message, /übersprungen/, err.message);
    return true;
  });
}

test('Migration läuft und ist wiederholbar', { skip }, async () => {
  const sql = await read('_supabase/mensa_v1.sql');
  await db.exec(sql);
  await db.exec(sql);
  const { rows } = await db.query(`select name, openmensa_id from public.mensa_canteens`);
  assert.deepEqual(rows, [{ name: 'Mensa im Neuenheimer Feld', openmensa_id: 279 }]);
  const pub = await db.query(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1`);
  assert.deepEqual(pub.rows.map(r => r.tablename), ['mensa_dishes', 'mensa_servings']);
});

test('Zugriffsregeln (mensa_v1_checks.sql) bestehen und hinterlassen nichts', { skip }, async () => {
  await runChecks();
  await runChecks(); // wiederholbar, weil alles zurückgerollt wird
  const left = await db.query(`
    select (select count(*) from auth.users)::int as users,
           (select count(*) from public.mensa_members)::int as members,
           (select count(*) from public.mensa_dishes)::int as dishes,
           (select count(*) from public.mensa_servings)::int as servings,
           (select count(*) from public.mensa_votes)::int as votes,
           (select count(*) from public.mensa_canteens)::int as canteens`);
  assert.deepEqual(left.rows[0], { users: 0, members: 0, dishes: 0, servings: 0, votes: 0, canteens: 1 });
});

test('Wiederholte Migration verändert vorhandene Daten nicht', { skip }, async () => {
  await db.exec(`
    insert into auth.users (id, email) values ('11111111-1111-4111-8111-111111111111', 'x@example.invalid');
    insert into public.mensa_members values ('11111111-1111-4111-8111-111111111111', 'X', true);
    insert into public.mensa_dishes (name, created_by) values ('Bleibt', '11111111-1111-4111-8111-111111111111');
    insert into public.mensa_servings (dish_id, canteen_id, created_by)
      select d.id, c.id, '11111111-1111-4111-8111-111111111111' from public.mensa_dishes d, public.mensa_canteens c;
    insert into public.mensa_votes (serving_id, user_id, rating)
      select id, '11111111-1111-4111-8111-111111111111', 7 from public.mensa_servings;`);
  await db.exec(await read('_supabase/mensa_v1.sql'));
  const { rows } = await db.query(`select d.name, v.rating from public.mensa_votes v
    join public.mensa_servings s on s.id = v.serving_id join public.mensa_dishes d on d.id = s.dish_id`);
  assert.deepEqual(rows, [{ name: 'Bleibt', rating: 7 }]);
  await db.exec(`delete from public.mensa_servings; delete from public.mensa_dishes;
                 delete from public.mensa_members; delete from auth.users;`);
});

test('Namensschlüssel: SQL und logic.js liefern dasselbe', { skip }, async () => {
  const require = createRequire(import.meta.url);
  const L = require('../../assets/mensa/logic.js');
  const names = [
    'Käsespätzle', '  KÄSESPÄTZLE!! ', 'Kaesespaetzle', 'Grießbrei', 'GRIESSBREI', 'Crème brûlée',
    'Chili sin Carne (vegan)', 'Pasta – Arrabbiata', 'Jalapeño-Burger', 'Smørrebrød', 'Æbleskiver',
    'Hähnchen-Curry „Thai“', 'Tagessuppe\n', '100% Rind', 'Ölige Ümläute', '', '   ', 'Straße', 'STRAẞE'
  ];
  for (const n of names) {
    const { rows } = await db.query('select public.mensa_name_key($1) as k', [n]);
    assert.equal(L.nameKey(n), rows[0].k, `Name: ${JSON.stringify(n)}`);
  }
});
