-- ════════════════════════════════════════════════════════════════════════════
-- Kicker-Ticker v2 – einmalig im Supabase SQL Editor ausführen.
-- Idempotent: kann gefahrlos mehrfach laufen. Bestehende Spiele bleiben unverändert.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. Neue Spalten ─────────────────────────────────────────────────────────
-- Positionen: bei positions_known = true gilt team*_player1 = Abwehr, team*_player2 = Sturm.
alter table public.games   add column if not exists positions_known boolean     not null default false;
alter table public.games   add column if not exists created_by      uuid        default auth.uid();
alter table public.games   add column if not exists created_at      timestamptz not null default now();
alter table public.games   alter column played_at set default now();
alter table public.players add column if not exists active          boolean     not null default true;

comment on column public.games.positions_known is 'true: team*_player1 = Abwehr, team*_player2 = Sturm';
comment on column public.players.elo is 'veraltet (v1) – Wertung wird seit v2 im Browser aus games berechnet';

-- ── 2. Datenregeln ──────────────────────────────────────────────────────────
-- NOT VALID: gilt für neue/geänderte Spiele, alte Daten werden nicht geprüft.
alter table public.games drop constraint if exists games_no_draw;
alter table public.games add  constraint games_no_draw check (score_team1 <> score_team2) not valid;

alter table public.games drop constraint if exists games_scores_valid;
alter table public.games add  constraint games_scores_valid
  check (score_team1 between 0 and 99 and score_team2 between 0 and 99) not valid;

-- Beide Teams gleich groß (1v1 oder 2v2)
alter table public.games drop constraint if exists games_same_team_size;
alter table public.games add  constraint games_same_team_size
  check ((team1_player2 is null) = (team2_player2 is null)) not valid;

-- Kein Spieler doppelt im selben Spiel
alter table public.games drop constraint if exists games_distinct_players;
alter table public.games add  constraint games_distinct_players check (
  team1_player1 <> team2_player1
  and (team1_player2 is null or team1_player2 not in (team1_player1, team2_player1))
  and (team2_player2 is null or team2_player2 not in (team1_player1, team2_player1, team1_player2))
) not valid;

-- ── 3. Admin-Prüfung ────────────────────────────────────────────────────────
-- Liest die admins-Tabelle serverseitig; die Tabelle selbst ist danach nicht mehr öffentlich lesbar.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- ── 4. Zugriffsrechte (Row Level Security) ─────────────────────────────────
-- Alte Policies entfernen, damit keine vergessene Regel mehr Schreibzugriff erlaubt.
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('games', 'players', 'seasons', 'season_snapshots', 'admins')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

alter table public.games            enable row level security;
alter table public.players          enable row level security;
alter table public.seasons          enable row level security;
alter table public.season_snapshots enable row level security;
alter table public.admins           enable row level security;  -- keine Policy = nur via is_admin()

-- Lesen: alle (auch ohne Login)
create policy "read games"     on public.games            for select to anon, authenticated using (true);
create policy "read players"   on public.players          for select to anon, authenticated using (true);
create policy "read seasons"   on public.seasons          for select to anon, authenticated using (true);
create policy "read snapshots" on public.season_snapshots for select to anon, authenticated using (true);

-- Spiele eintragen: jeder eingeloggte Account, nur in die laufende Saison, nur unter eigenem Namen
create policy "insert games" on public.games for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (select 1 from public.seasons s where s.id = season_id and s.is_active)
  );

-- Spiele ändern: nur Admin
create policy "update games" on public.games for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Spiele löschen: Admin immer, eigene Einträge 15 Minuten lang (Tippfehler rückgängig machen)
create policy "delete games" on public.games for delete to authenticated
  using (
    public.is_admin()
    or (created_by = auth.uid() and created_at > now() - interval '15 minutes')
  );

-- Spieler, Saisons, Snapshots verwalten: nur Admin
create policy "admin players"   on public.players          for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "admin seasons"   on public.seasons          for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "admin snapshots" on public.season_snapshots for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ── 5. Live-Updates ─────────────────────────────────────────────────────────
-- Neue Spiele erscheinen bei allen offenen Seiten ohne Neuladen.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'games'
  ) then
    alter publication supabase_realtime add table public.games;
  end if;
end $$;

commit;
