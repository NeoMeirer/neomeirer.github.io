-- ════════════════════════════════════════════════════════════════════════════
-- Kicker-Ticker v2.1 – neue Spieler beim Eintragen anlegen.
-- Einmalig im Supabase SQL Editor ausführen (nach kicker_v2.sql). Idempotent.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- Jeder eingeloggte Account darf Spieler anlegen (nur aktiv).
-- Umbenennen, Deaktivieren und Löschen bleibt beim Admin (Policy "admin players").
drop policy if exists "insert players" on public.players;
create policy "insert players" on public.players for insert to authenticated
  with check (active);

-- Namen: 1–40 Zeichen, keine Duplikate (Groß-/Kleinschreibung egal)
alter table public.players drop constraint if exists players_name_length;
alter table public.players add  constraint players_name_length
  check (char_length(btrim(name)) between 1 and 40) not valid;
create unique index if not exists players_name_unique on public.players (lower(btrim(name)));

commit;
