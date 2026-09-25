-- ════════════════════════════════════════════════════════════════════════════
-- Mensa-Ranking v1 – Selbsttest der Zugriffsregeln (nach mensa_v1.sql ausführen).
--
-- Legt vier Test-Accounts (@example.invalid) und Testdaten an, prüft als diese Accounts,
-- ob Supabase die Regeln durchsetzt, und verwirft danach ALLES wieder.
-- Das Skript ist ein einziger DO-Block und endet absichtlich mit einer Fehlermeldung –
-- nur so ist garantiert, dass keine Testdaten gespeichert werden:
--   „MENSA-CHECKS BESTANDEN …“        → alles in Ordnung (rote Meldung ist Absicht)
--   „CHECK FEHLGESCHLAGEN: …“         → diese Regel greift nicht, bitte melden
-- Dieselbe Datei läuft lokal in _tests/mensa/db.test.mjs (PGlite).
-- ════════════════════════════════════════════════════════════════════════════
do $checks$
declare
  v_admin uuid := 'c0ffee00-0000-4000-8000-000000000001';
  v_anna  uuid := 'c0ffee00-0000-4000-8000-000000000002';
  v_ben   uuid := 'c0ffee00-0000-4000-8000-000000000003';
  v_fremd uuid := 'c0ffee00-0000-4000-8000-000000000004';
  v_canteen  integer;
  v_canteen2 integer;
  r   jsonb;
  n   integer;
  s1  bigint; s2 bigint; s3 bigint; s4 bigint; s_future bigint; s_nophoto bigint;
  d1  bigint; d2 bigint; d3 bigint; d4 bigint;
  v_text text;
  v_storage_note text := '';
begin
  if to_regclass('public.mensa_votes') is null then
    raise exception 'Bitte zuerst _supabase/mensa_v1.sql ausführen.';
  end if;

  -- Rollenwechsel wie bei einer echten API-Anfrage (Rolle + JWT-Claims)
  create function pg_temp.mensa_login(p_user uuid) returns void language plpgsql as $f$
  begin
    if p_user is null then
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      perform set_config('role', 'anon', true);
    else
      perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
    end if;
  end $f$;

  -- ── Testdaten ─────────────────────────────────────────────────────────────
  insert into auth.users (id, email) values
    (v_admin, 'mensa-check-admin@example.invalid'),
    (v_anna,  'mensa-check-anna@example.invalid'),
    (v_ben,   'mensa-check-ben@example.invalid'),
    (v_fremd, 'mensa-check-fremd@example.invalid');
  insert into public.mensa_members (user_id, display_name, is_admin) values
    (v_admin, 'Check-Admin', true), (v_anna, 'Check-Anna', false), (v_ben, 'Check-Ben', false);
  select id into v_canteen from public.mensa_canteens where name = 'Mensa im Neuenheimer Feld';
  insert into public.mensa_canteens (name) values ('Check-Mensa (Test)') returning id into v_canteen2;
  assert v_canteen is not null, 'CHECK FEHLGESCHLAGEN: Startdaten (Mensa im Neuenheimer Feld) fehlen';

  -- ── 1. Nicht angemeldet: kein Zugriff ────────────────────────────────────
  perform pg_temp.mensa_login(null);
  begin
    perform count(*) from public.mensa_servings;
    raise exception 'CHECK FEHLGESCHLAGEN: anon kann Einträge lesen';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.mensa_me();
    raise exception 'CHECK FEHLGESCHLAGEN: anon kann mensa_me() aufrufen';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.mensa_members;
    raise exception 'CHECK FEHLGESCHLAGEN: anon kann Mitglieder lesen';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- ── 2. Mitglied trägt ein; Doppeleinträge und Namensgleichheit ───────────
  perform pg_temp.mensa_login(v_anna);
  r := public.mensa_me();
  assert (r->>'member')::boolean and not (r->>'admin')::boolean and r->>'name' = 'Check-Anna',
    'CHECK FEHLGESCHLAGEN: mensa_me() für Mitglied falsch: ' || r::text;

  r := public.mensa_add_serving(p_canteen_id => v_canteen, p_dish_name => '  Käsespätzle  ', p_price_cents => 380, p_note => 'Check');
  assert not (r->>'existed')::boolean and (r->>'new_dish')::boolean, 'CHECK FEHLGESCHLAGEN: erster Eintrag ' || r::text;
  s1 := (r->>'serving_id')::bigint; d1 := (r->>'dish_id')::bigint;

  -- gleicher Name in anderer Schreibweise = dasselbe Gericht, gleicher Tag = derselbe Eintrag
  r := public.mensa_add_serving(p_canteen_id => v_canteen, p_dish_name => 'KAESESPAETZLE!');
  assert (r->>'existed')::boolean and (r->>'serving_id')::bigint = s1 and (r->>'dish_id')::bigint = d1,
    'CHECK FEHLGESCHLAGEN: Doppeleintrag wurde nicht erkannt ' || r::text;
  r := public.mensa_add_serving(p_canteen_id => v_canteen, p_dish_id => d1);
  assert (r->>'existed')::boolean and (r->>'serving_id')::bigint = s1, 'CHECK FEHLGESCHLAGEN: Doppeleintrag per Gericht-ID';

  -- ähnlicher, aber nicht gleicher Name wird NIE zusammengelegt
  r := public.mensa_add_serving(p_canteen_id => v_canteen, p_dish_name => 'Käsespätzle mit Röstzwiebeln');
  assert not (r->>'existed')::boolean and (r->>'dish_id')::bigint <> d1, 'CHECK FEHLGESCHLAGEN: ähnlicher Name wurde zusammengelegt';
  s2 := (r->>'serving_id')::bigint; d2 := (r->>'dish_id')::bigint;

  -- mehrere Gerichte am selben Tag in derselben Mensa sind erlaubt
  r := public.mensa_add_serving(p_canteen_id => v_canteen, p_dish_name => 'Linsensuppe');
  assert not (r->>'existed')::boolean, 'CHECK FEHLGESCHLAGEN: zweites Gericht am selben Tag blockiert';
  s3 := (r->>'serving_id')::bigint; d3 := (r->>'dish_id')::bigint;
  -- gleiches Gericht in einer anderen Mensa am selben Tag ist ein eigener Eintrag
  r := public.mensa_add_serving(p_canteen_id => v_canteen2, p_dish_id => d1);
  assert not (r->>'existed')::boolean and (r->>'serving_id')::bigint <> s1, 'CHECK FEHLGESCHLAGEN: andere Mensa';

  begin
    perform public.mensa_add_serving(p_canteen_id => v_canteen, p_served_on => public.mensa_today() + 1, p_dish_id => d1);
    raise exception 'CHECK FEHLGESCHLAGEN: Eintrag in der Zukunft möglich';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.mensa_add_serving(p_canteen_id => v_canteen, p_dish_name => '   ');
    raise exception 'CHECK FEHLGESCHLAGEN: leerer Gerichtsname möglich';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.mensa_add_serving(p_canteen_id => v_canteen, p_dish_name => 'Nudeln', p_price_cents => 999999);
    raise exception 'CHECK FEHLGESCHLAGEN: absurder Preis möglich';
  exception when check_violation then null;
  end;
  -- direkt an der Funktion vorbei: fremder Name / Foto beim Anlegen
  begin
    insert into public.mensa_servings (dish_id, canteen_id, created_by) values (d3, v_canteen2, v_ben);
    raise exception 'CHECK FEHLGESCHLAGEN: Eintrag unter fremdem Namen möglich';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.mensa_servings (dish_id, canteen_id, photo_path, thumb_path)
      values (d3, v_canteen2, v_anna || '/x.jpg', v_anna || '/x-t.jpg');
    raise exception 'CHECK FEHLGESCHLAGEN: Foto am Upload vorbei setzbar';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.mensa_dishes (name, created_by) values ('Check-Fremdgericht', v_ben);
    raise exception 'CHECK FEHLGESCHLAGEN: Gericht unter fremdem Namen möglich';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- ── 3. Außenstehende (angemeldet, aber kein Mitglied) ────────────────────
  perform pg_temp.mensa_login(v_fremd);
  r := public.mensa_me();
  assert not (r->>'member')::boolean, 'CHECK FEHLGESCHLAGEN: Außenstehende:r gilt als Mitglied';
  select count(*) into n from public.mensa_servings;
  assert n = 0, 'CHECK FEHLGESCHLAGEN: Außenstehende:r sieht Einträge';
  select count(*) into n from public.mensa_dishes;
  assert n = 0, 'CHECK FEHLGESCHLAGEN: Außenstehende:r sieht Gerichte';
  select count(*) into n from public.mensa_members;
  assert n = 0, 'CHECK FEHLGESCHLAGEN: Außenstehende:r sieht Mitglieder';
  select count(*) into n from public.mensa_serving_stats();
  assert n = 0, 'CHECK FEHLGESCHLAGEN: Außenstehende:r sieht Statistik';
  begin
    perform public.mensa_add_serving(p_canteen_id => v_canteen, p_dish_name => 'Einbruch');
    raise exception 'CHECK FEHLGESCHLAGEN: Außenstehende:r kann eintragen';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.mensa_vote(s1, 10);
    raise exception 'CHECK FEHLGESCHLAGEN: Außenstehende:r kann abstimmen';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.mensa_members (user_id, display_name) values (v_fremd, 'Ich');
    raise exception 'CHECK FEHLGESCHLAGEN: Außenstehende:r kann sich selbst freischalten';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- ── 4. Stimmen: eine pro Person, änderbar, 1–10, anonym ──────────────────
  perform pg_temp.mensa_login(v_anna);
  r := public.mensa_vote(s1, 8);
  assert (r->>'votes')::int = 1 and (r->>'avg_rating')::numeric = 8, 'CHECK FEHLGESCHLAGEN: erste Stimme ' || r::text;
  r := public.mensa_vote(s1, 9, 2);
  assert (r->>'votes')::int = 1 and (r->>'avg_rating')::numeric = 9 and (r->>'filling_medium')::int = 1,
    'CHECK FEHLGESCHLAGEN: Stimme ändern ' || r::text;
  begin
    perform public.mensa_vote(s1, 11);
    raise exception 'CHECK FEHLGESCHLAGEN: Note 11 möglich';
  exception when check_violation then null;
  end;
  begin
    perform public.mensa_vote(s1, 0);
    raise exception 'CHECK FEHLGESCHLAGEN: Note 0 möglich';
  exception when check_violation then null;
  end;
  begin
    perform public.mensa_vote(s1, 5, 4);
    raise exception 'CHECK FEHLGESCHLAGEN: Sättigung 4 möglich';
  exception when check_violation then null;
  end;
  reset role;

  perform pg_temp.mensa_login(v_ben);
  r := public.mensa_vote(s1, 6);
  assert (r->>'votes')::int = 2 and (r->>'rating_sum')::int = 15 and (r->>'avg_rating')::numeric = 7.5,
    'CHECK FEHLGESCHLAGEN: zweite Person ' || r::text;
  select count(*) into n from public.mensa_votes where user_id <> v_ben;
  assert n = 0, 'CHECK FEHLGESCHLAGEN: Einzelstimmen anderer sind sichtbar';
  select count(*) into n from public.mensa_votes;
  assert n = 1, 'CHECK FEHLGESCHLAGEN: eigene Stimme nicht lesbar';
  update public.mensa_votes set rating = 1 where serving_id = s1 and user_id = v_anna;
  get diagnostics n = row_count;
  assert n = 0, 'CHECK FEHLGESCHLAGEN: fremde Stimme änderbar';
  delete from public.mensa_votes where user_id = v_anna;
  get diagnostics n = row_count;
  assert n = 0, 'CHECK FEHLGESCHLAGEN: fremde Stimme löschbar';
  begin
    insert into public.mensa_votes (serving_id, user_id, rating) values (s3, v_anna, 1);
    raise exception 'CHECK FEHLGESCHLAGEN: Stimme im Namen anderer möglich';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.mensa_votes set user_id = v_anna where serving_id = s1 and user_id = v_ben;
    raise exception 'CHECK FEHLGESCHLAGEN: eigene Stimme auf andere Person umschreibbar';
  exception when insufficient_privilege then null;
  end;
  r := public.mensa_unvote(s1);
  assert (r->>'votes')::int = 1 and (r->>'avg_rating')::numeric = 9, 'CHECK FEHLGESCHLAGEN: Stimme zurückziehen ' || r::text;
  r := public.mensa_vote(s1, 6);
  reset role;

  -- nicht für eingetragene Zukunftstermine
  insert into public.mensa_servings (dish_id, canteen_id, served_on, created_by)
    values (d3, v_canteen, public.mensa_today() + 1, v_anna) returning id into s_future;
  perform pg_temp.mensa_login(v_anna);
  begin
    perform public.mensa_vote(s_future, 7);
    raise exception 'CHECK FEHLGESCHLAGEN: Bewertung eines Zukunftstermins möglich';
  exception when insufficient_privilege then null;
  end;
  reset role;
  delete from public.mensa_servings where id = s_future;

  -- Jede Stimme berührt die Ausgabe (Live-Update), ohne Personen preiszugeben
  select count(*) into n from public.mensa_servings where id = s1 and activity_at >= created_at;
  assert n = 1, 'CHECK FEHLGESCHLAGEN: activity_at wird nicht gesetzt';

  -- ── 5. Einträge ändern/löschen ───────────────────────────────────────────
  perform pg_temp.mensa_login(v_ben);
  update public.mensa_servings set note = 'von Ben' where id = s1;
  get diagnostics n = row_count;
  assert n = 0, 'CHECK FEHLGESCHLAGEN: fremder Eintrag änderbar';
  delete from public.mensa_servings where id = s1;
  get diagnostics n = row_count;
  assert n = 0, 'CHECK FEHLGESCHLAGEN: fremder Eintrag löschbar';
  reset role;

  perform pg_temp.mensa_login(v_anna);
  update public.mensa_servings set note = 'korrigiert', created_by = v_ben, created_at = now() + interval '1 day' where id = s1;
  get diagnostics n = row_count;
  assert n = 1, 'CHECK FEHLGESCHLAGEN: eigener frischer Eintrag nicht korrigierbar';
  select count(*) into n from public.mensa_servings where id = s1 and created_by = v_anna and created_at <= now();
  assert n = 1, 'CHECK FEHLGESCHLAGEN: Ersteller:in/Zeitpunkt nachträglich änderbar';
  begin
    update public.mensa_servings set photo_path = v_anna || '/a.jpg', thumb_path = v_anna || '/a-t.jpg' where id = s1;
    raise exception 'CHECK FEHLGESCHLAGEN: Foto-Pfad direkt änderbar';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.mensa_servings set served_on = public.mensa_today() + 3 where id = s1;
    raise exception 'CHECK FEHLGESCHLAGEN: Datum in die Zukunft verschiebbar';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- nach 15 Minuten nur noch Admin
  update public.mensa_servings set created_at = now() - interval '20 minutes' where id in (s1, s3);
  perform pg_temp.mensa_login(v_anna);
  update public.mensa_servings set note = 'zu spät' where id = s1;
  get diagnostics n = row_count;
  assert n = 0, 'CHECK FEHLGESCHLAGEN: Korrektur nach 15 Minuten noch möglich';
  delete from public.mensa_servings where id = s3;
  get diagnostics n = row_count;
  assert n = 0, 'CHECK FEHLGESCHLAGEN: Löschen nach 15 Minuten noch möglich';
  reset role;

  perform pg_temp.mensa_login(v_admin);
  update public.mensa_servings set note = 'vom Admin' where id = s1;
  get diagnostics n = row_count;
  assert n = 1, 'CHECK FEHLGESCHLAGEN: Admin kann nicht korrigieren';
  r := public.mensa_vote(s3, 4);
  delete from public.mensa_servings where id = s3;
  get diagnostics n = row_count;
  assert n = 1, 'CHECK FEHLGESCHLAGEN: Admin kann nicht löschen';
  reset role;
  select count(*) into n from public.mensa_votes where serving_id = s3;
  assert n = 0, 'CHECK FEHLGESCHLAGEN: Stimmen gelöschter Einträge bleiben übrig';

  -- ── 6. Gerichte & Mitglieder verwalten ───────────────────────────────────
  perform pg_temp.mensa_login(v_anna);
  update public.mensa_dishes set name = 'Umbenannt' where id = d1;
  get diagnostics n = row_count;
  assert n = 0, 'CHECK FEHLGESCHLAGEN: Mitglied kann Gericht umbenennen';
  delete from public.mensa_dishes where id = d2;
  get diagnostics n = row_count;
  assert n = 0, 'CHECK FEHLGESCHLAGEN: Mitglied kann Gericht löschen';
  update public.mensa_members set is_admin = true where user_id = v_anna;
  get diagnostics n = row_count;
  assert n = 0, 'CHECK FEHLGESCHLAGEN: Mitglied kann sich zum Admin machen';
  select count(*) into n from public.mensa_members;
  assert n >= 3, 'CHECK FEHLGESCHLAGEN: Mitglied sieht die Gruppe nicht';
  begin
    perform public.mensa_merge_dishes(d1, d2);
    raise exception 'CHECK FEHLGESCHLAGEN: Mitglied kann Gerichte zusammenführen';
  exception when insufficient_privilege then null;
  end;
  begin
    truncate public.mensa_votes;
    raise exception 'CHECK FEHLGESCHLAGEN: TRUNCATE möglich';
  exception when insufficient_privilege then null;
  end;
  reset role;

  perform pg_temp.mensa_login(v_admin);
  update public.mensa_dishes set name = 'Käsespätzle (Check)' where id = d1;
  get diagnostics n = row_count;
  assert n = 1, 'CHECK FEHLGESCHLAGEN: Admin kann Gericht nicht umbenennen';
  begin
    update public.mensa_dishes set name = 'käsespätzle - check' where id = d2;
    raise exception 'CHECK FEHLGESCHLAGEN: zwei Gerichte mit gleichem Namen möglich';
  exception when unique_violation then null;
  end;
  -- d1 und d2 stehen am selben Tag in derselben Mensa → Zusammenführen wird abgelehnt
  begin
    perform public.mensa_merge_dishes(d1, d2);
    raise exception 'CHECK FEHLGESCHLAGEN: Zusammenführen trotz Tageskonflikt';
  exception when unique_violation then null;
  end;
  reset role;

  perform pg_temp.mensa_login(v_anna);
  r := public.mensa_add_serving(p_canteen_id => v_canteen2, p_dish_name => 'Linsen-Eintopf');
  s4 := (r->>'serving_id')::bigint; d4 := (r->>'dish_id')::bigint;
  reset role;
  perform pg_temp.mensa_login(v_admin);
  perform public.mensa_merge_dishes(d3, d4);
  reset role;
  select count(*) into n from public.mensa_servings where id = s4 and dish_id = d3;
  assert n = 1, 'CHECK FEHLGESCHLAGEN: Zusammenführen verschiebt Einträge nicht';
  select count(*) into n from public.mensa_dishes where id = d4;
  assert n = 0, 'CHECK FEHLGESCHLAGEN: zusammengeführtes Gericht bleibt bestehen';

  -- ── 7. Fotos ─────────────────────────────────────────────────────────────
  perform pg_temp.mensa_login(v_anna);
  begin
    insert into storage.objects (bucket_id, name, owner, owner_id)
      values ('mensa-photos', v_anna || '/check.jpg', v_anna, v_anna::text),
             ('mensa-photos', v_anna || '/check-t.jpg', v_anna, v_anna::text);
  exception
    when insufficient_privilege then raise exception 'CHECK FEHLGESCHLAGEN: Mitglied kann nicht in eigenen Ordner hochladen';
    when others then v_storage_note := sqlerrm;
  end;
  begin
    insert into storage.objects (bucket_id, name, owner, owner_id)
      values ('mensa-photos', v_ben || '/fremd.jpg', v_anna, v_anna::text);
    raise exception 'CHECK FEHLGESCHLAGEN: Upload in fremden Ordner möglich';
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm like 'CHECK FEHLGESCHLAGEN%' then raise; end if;
      v_storage_note := sqlerrm;
  end;

  if v_storage_note = '' then
    perform public.mensa_set_photo(s1, v_anna || '/check.jpg', v_anna || '/check-t.jpg');
    select count(*) into n from public.mensa_servings where id = s1 and photo_path = v_anna || '/check.jpg';
    assert n = 1, 'CHECK FEHLGESCHLAGEN: Foto wurde nicht gesetzt';
    select count(*) into n from storage.objects where bucket_id = 'mensa-photos' and name like v_anna || '/check%';
    assert n = 2, 'CHECK FEHLGESCHLAGEN: Mitglied kann Fotos nicht lesen';
  end if;
  reset role;

  perform pg_temp.mensa_login(v_ben);
  if v_storage_note = '' then
    begin
      perform public.mensa_set_photo(s1, v_ben || '/b.jpg', v_ben || '/b-t.jpg');
      raise exception 'CHECK FEHLGESCHLAGEN: fremdes Foto überschreibbar';
    exception when insufficient_privilege then null;
    end;
    delete from storage.objects where bucket_id = 'mensa-photos' and name = v_anna || '/check.jpg';
    get diagnostics n = row_count;
    assert n = 0, 'CHECK FEHLGESCHLAGEN: fremde Fotodatei löschbar';
  end if;
  -- Eintrag ohne Foto: fremde Dateien oder nicht hochgeladene Dateien sind nicht verknüpfbar
  select id into s_nophoto from public.mensa_servings where id = s2;
  begin
    perform public.mensa_set_photo(s_nophoto, v_anna || '/check.jpg', v_anna || '/check-t.jpg');
    raise exception 'CHECK FEHLGESCHLAGEN: Foto aus fremdem Ordner verknüpfbar';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.mensa_set_photo(s_nophoto, v_ben || '/gibtsnicht.jpg', v_ben || '/gibtsnicht-t.jpg');
    raise exception 'CHECK FEHLGESCHLAGEN: nicht hochgeladenes Foto verknüpfbar';
  exception when no_data_found then null;
  end;
  begin
    perform public.mensa_set_photo(s1, null, null);
    raise exception 'CHECK FEHLGESCHLAGEN: fremdes Foto entfernbar';
  exception when insufficient_privilege then null;
  end;
  reset role;

  perform pg_temp.mensa_login(v_fremd);
  begin
    insert into storage.objects (bucket_id, name, owner, owner_id)
      values ('mensa-photos', v_fremd || '/x.jpg', v_fremd, v_fremd::text);
    raise exception 'CHECK FEHLGESCHLAGEN: Außenstehende:r kann Fotos hochladen';
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm like 'CHECK FEHLGESCHLAGEN%' then raise; end if;
      v_storage_note := sqlerrm;
  end;
  select count(*) into n from storage.objects where bucket_id = 'mensa-photos';
  assert n = 0, 'CHECK FEHLGESCHLAGEN: Außenstehende:r sieht Fotos';
  reset role;

  perform pg_temp.mensa_login(v_admin);
  perform public.mensa_set_photo(s1, null, null);
  reset role;
  select count(*) into n from public.mensa_servings where id = s1 and photo_path is null;
  assert n = 1, 'CHECK FEHLGESCHLAGEN: Admin kann Foto nicht entfernen';

  select public into v_text from storage.buckets where id = 'mensa-photos';
  assert v_text = 'false', 'CHECK FEHLGESCHLAGEN: Foto-Bucket ist öffentlich';

  -- ── Ergebnis: absichtlich als Fehler, damit alles zurückgerollt wird ─────
  raise exception using
    errcode = 'MNS00',
    message = 'MENSA-CHECKS BESTANDEN – alle Testdaten wurden verworfen.'
      || case when v_storage_note <> '' then ' (Storage-Teil übersprungen: ' || v_storage_note || ' – bitte Foto-Upload mit der App testen.)' else '' end;
end
$checks$;
