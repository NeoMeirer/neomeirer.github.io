# Mensa-Ranking – Einrichtung

Seite: <https://neomeirer.github.io/mensa/> · Supabase-Projekt `bheloocuzjmhtlmqjvxb` (nur für das Mensa-Ranking, getrennt vom Kicker-Ticker).
Alle Rechte setzt Supabase durch (Row Level Security + Storage-Policies). Im Repository liegt nur der öffentliche Publishable Key.

## 1. Datenbank anlegen (einmalig, ~1 Minute)

1. Supabase-Dashboard → Projekt öffnen → **SQL Editor** → *New query*.
2. Inhalt von [`mensa_v1.sql`](mensa_v1.sql) einfügen → **Run**.
   Erwartet: *Success. No rows returned.* Die Datei kann gefahrlos erneut laufen (nur additiv, keine Löschungen).

Angelegt werden: `mensa_members`, `mensa_canteens` (mit „Mensa im Neuenheimer Feld“, OpenMensa-ID 279), `mensa_dishes`, `mensa_servings`, `mensa_votes`, die Funktionen `mensa_*`, der private Bucket `mensa-photos` (JPEG/WebP, max. 3 MB) und Realtime für Einträge und Gerichte.

## 2. Registrierung abschalten

**Authentication → Sign In / Providers → „Allow new users to sign up“ ausschalten.**
Dann entstehen Accounts nur noch durch dich. (Das Mensa-Ranking ist auch ohne diesen Schritt geschützt, weil zusätzlich die Mitgliederliste geprüft wird.)

> Empfehlung auch für das **Kicker-Projekt** (`qqoxwxomidrdkwhwndcg`): Dort ist die Registrierung derzeit offen, und jede eingeloggte Person darf Spiele eintragen. Wer sich selbst registriert, könnte also Kicker-Spiele anlegen. Gleicher Schalter, im Kicker-Projekt.

## 3. Accounts anlegen

Pro Person: **Authentication → Users → Add user → Create new user**
- E-Mail und ein Startpasswort eintragen, **„Auto Confirm User“** anhaken.
- Startpasswort persönlich weitergeben; ändern geht danach auf der Seite unter *Name oben rechts → Passwort ändern*.
- Passwort vergessen: im selben Menü beim Nutzer ein neues setzen.

## 4. Mitglieder freischalten

Ein Account allein sieht nichts – erst der Eintrag in `mensa_members` schaltet frei. Im SQL Editor (E-Mail und Namen anpassen):

```sql
-- du als Admin
insert into public.mensa_members (user_id, display_name, is_admin)
select id, 'Neo', true from auth.users where email = 'deine@mail.de'
on conflict (user_id) do update set display_name = excluded.display_name, is_admin = excluded.is_admin;

-- weitere Mitglieder (eine Zeile pro Person)
insert into public.mensa_members (user_id, display_name)
select id, 'Anna' from auth.users where email = 'anna@example.com'
on conflict (user_id) do update set display_name = excluded.display_name;

-- Kontrolle
select m.display_name, m.is_admin, u.email from public.mensa_members m join auth.users u on u.id = m.user_id;
```

Jemanden entfernen: `delete from public.mensa_members where user_id = (select id from auth.users where email = '…');`
Die Person sieht danach nichts mehr; ihre bisherigen Stimmen bleiben in den Schnitten erhalten.

## 5. Selbsttest der Regeln

SQL Editor → Inhalt von [`mensa_v1_checks.sql`](mensa_v1_checks.sql) → **Run**.

- Erwartet wird eine **rote** Meldung **„MENSA-CHECKS BESTANDEN – alle Testdaten wurden verworfen.“** Das Rot ist Absicht: Das Skript bricht am Ende bewusst ab, damit garantiert nichts gespeichert bleibt.
- „CHECK FEHLGESCHLAGEN: …“ heißt: Diese Regel greift nicht – bitte melden.
- Steht dort „Storage-Teil übersprungen“, ließ Supabase den direkten Test der Foto-Regeln per SQL nicht zu. Dann bitte den Foto-Teil unten mit der App testen.

Das Skript prüft u. a.: kein Zugriff ohne Login oder ohne Mitgliedschaft, eine Stimme pro Person, Note nur 1–10, Stimmen anderer unsichtbar, Doppeleinträge, ähnliche Namen werden nicht zusammengelegt, 15-Minuten-Regel, Admin-Rechte, Fotos nur im eigenen Ordner.

## 6. Test mit zwei Accounts

A = du (Admin), B = zweites Mitglied. Am besten zwei Geräte, oder zweites Browserprofil / privates Fenster.

1. **Login:** A und B melden sich an. Ein dritter Account ohne Eintrag in `mensa_members` sieht nur „Noch nicht freigeschaltet“.
2. **Eintragen:** A trägt mit dem Handy ein Essen mit Foto ein → erscheint sofort bei A; bei B ohne Neuladen innerhalb weniger Sekunden.
3. **Abstimmen:** B tippt 7 → beide sehen „Ø 7,0 · 1 Stimme · wenige Stimmen“. A tippt 9 → „Ø 8,0 · 2 Stimmen“.
4. **Stimme ändern:** B tippt 5 → „Ø 7,0 · 2 Stimmen“ (weiterhin 2, nicht 3). „zurückziehen“ → 1 Stimme.
5. **Gleichzeitig:** Beide tippen im selben Moment eine Note → Anzahl stimmt danach.
6. **Doppelt:** B trägt dasselbe Gericht am selben Tag nochmal ein (auch anders geschrieben, z. B. „KAESESPAETZLE“) → „Gibt es schon – du kannst direkt bewerten“.
7. **Ähnlicher Name:** B tippt z. B. „Käsespätzle mit Zwiebeln“ → Rückfrage „Ist es eins davon?“ statt automatischer Zuordnung.
8. **Rechte:** B sieht bei den Einträgen von A weder „Bearbeiten“ noch „Löschen“. B's eigener Eintrag: 15 Minuten lang bearbeitbar, danach nicht mehr. A (Admin) kann alles bearbeiten, löschen, Fotos entfernen, Gerichte umbenennen und zusammenführen.
9. **Foto:** Ein Eintrag ohne Foto → „Foto hinzufügen“ funktioniert für jedes Mitglied; ein vorhandenes Foto kann nur Ersteller:in oder Admin ersetzen/entfernen.
10. **Wiederkehrend:** An einem späteren Tag dasselbe Gericht eintragen → Karte zeigt „Früher (1×, zuletzt …): Ø … · … Stimmen“ getrennt von heute.
11. **Schlechter Empfang:** Flugmodus an, Seite neu öffnen → letzter Stand mit Hinweis „Offline“.

## Was wo gespeichert ist

| Was | Wer sieht es |
|---|---|
| E-Mail, Passwort (Supabase Auth) | nur du im Dashboard |
| Anzeigename | Mitglieder |
| Einträge (Gericht, Mensa, Datum, Notiz, Foto, wer eingetragen hat) | Mitglieder |
| Einzelne Noten und Sättigungs-Eindrücke | nur die Person selbst (und du im Dashboard) – alle anderen sehen Anzahl und Schnitt |
| Fotos | Mitglieder, über Links, die nach 1 Tag ablaufen; vor dem Upload verkleinert, EXIF/GPS entfernt |

Die Tagesgerichte lädt der Browser direkt von openmensa.org (öffentliche API, ohne Login). Abschalten: im Layout `openmensa: false` setzen.

**Nährwerte:** OpenMensa und die Speiseplan-Seite des Studierendenwerks Heidelberg liefern für die Mensa im Neuenheimer Feld keine Kalorien/Makros. Deshalb gibt es keine Zahlen. Das Feld „Sättigung“ ist ausdrücklich ein persönlicher Eindruck, kein Messwert, und fließt nicht in die Note ein.

## Betrieb

- Kostenlose Supabase-Projekte pausieren nach 7 Tagen ohne Nutzung (z. B. Semesterferien). Die Seite zeigt dann „Daten konnten nicht geladen werden“ → im Dashboard **Restore** klicken.
- Speicher: ~200 KB pro Foto → das Gratis-Kontingent (1 GB) reicht für mehrere tausend Einträge.
- Weitere Mensa: `insert into public.mensa_canteens (name, openmensa_id) values ('zeughaus-Mensa im Marstall', 282);` – dann erscheint automatisch eine Auswahl im Formular. (OpenMensa-IDs: Triplex 281, Marstall 282.)
- Lokale Tests: `cd _tests && npm install && npm test` (Logik + Migration/RLS gegen PGlite).
