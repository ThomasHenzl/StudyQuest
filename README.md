# StudyQuest

StudyQuest ist ein deutschsprachiges Lern-Dashboard mit RPG-Fortschritt, Hausaufgaben, Noten, Lernzeit, Quests und Achievements.

## Sofort ausprobieren

1. Starte die App mit `npm run dev`.
2. Wähle **Registrieren**, gib Namen, E-Mail und ein mindestens 8 Zeichen langes Passwort ein.
3. Melde dich später mit derselben E-Mail-Adresse und demselben Passwort wieder an.

Ohne Supabase läuft StudyQuest im lokalen Testmodus. Konto und Fortschritt bleiben in diesem Browser auf diesem Gerät und werden nicht online synchronisiert. Nutze dafür kein Passwort, das du anderswo verwendest. Zum Zurücksetzen der lokalen Testkonten die Website-Daten dieses Browsers löschen.

## Online veröffentlichen (GitHub Pages)

1. Erstelle ein GitHub-Repository und lade den Projektordner mit dem Branch `main` hoch.
2. Öffne im Repository **Settings → Pages** und wähle unter **Build and deployment** als Quelle **GitHub Actions**.
3. Der Workflow baut und veröffentlicht die Website nach jedem Push auf `main`. Die veröffentlichte URL findest du anschließend unter **Settings → Pages**.

Ohne Supabase ist die Website öffentlich erreichbar, aber Konten und Lernstände werden nur lokal im jeweiligen Browser gespeichert und nicht zwischen Geräten synchronisiert. Für gemeinsame Online-Daten:

1. Erstelle ein Projekt auf [supabase.com](https://supabase.com/) und öffne dessen **SQL Editor**.
2. Führe die drei Dateien unter `supabase/migrations/` der Reihe nach aus: zuerst `202611050001_studyquest.sql`, dann `202611050002_adjustable_study_time.sql` und zuletzt `202611060001_daily_xp_decay.sql`.
3. Öffne in GitHub **Settings → Secrets and variables → Actions → Variables** und füge diese Repository-Variablen hinzu:
   - `VITE_SUPABASE_URL`: die **Project URL** aus den Supabase-Projekteinstellungen
   - `VITE_SUPABASE_ANON_KEY`: der **anon/public key** aus den Supabase-API-Einstellungen
4. Starte unter GitHub **Actions → Deploy to GitHub Pages → Run workflow** eine neue Veröffentlichung.

Der Deploy-Workflow verwendet diese Variablen beim Build. Der anon/public key ist für den Einsatz im Browser vorgesehen; den **service_role key** niemals eintragen oder veröffentlichen. Nach dem Deployment können sich Nutzer registrieren und ihre Daten über verschiedene Geräte hinweg speichern.

## Echtes Online-Konto (optional)

1. Installiere die Abhängigkeiten: `npm install`
2. Führe die drei SQL-Dateien unter `supabase/migrations/` der Reihe nach im SQL-Editor deines Supabase-Projekts aus.
3. Kopiere `.env.example` nach `.env.local` und trage die Project URL sowie den anon/public key aus den Supabase-Projekteinstellungen ein.
4. Starte die App mit `npm run dev` neu. Einen Produktionsbuild erstellst du mit `npm run build`.

Mit konfiguriertem Supabase werden Registrierung, Anmeldung und Fortschritt über dein Projekt gespeichert. Verwende im Frontend ausschließlich den Supabase anon/public key. Der Service-Role-Key darf nicht in die Client-Konfiguration gelangen. Die Datenbankmigration aktiviert Row Level Security für alle Nutzertabellen; SQL-RPCs vergeben XP nur nach serverseitiger Prüfung.

## Spielregeln

- Hausaufgabe abschließen: 50 XP
- Lernzeit erfassen: Dauer von 1 bis 600 Minuten frei wählbar, 1 XP pro Minute
- Testnoten 1–5: 200 / 150 / 100 / 50 / 0 XP
- Prüfungsnoten 1–5: 400 / 300 / 200 / 100 / 0 XP
- Levels benötigen jeweils 100 XP; die maximale Stufe ist 100.
- Beim ersten Laden an einem neuen UTC-Kalendertag werden automatisch 20 XP abgezogen. Nach Pausen werden versäumte Tagesabzüge nachgeholt; XP können nicht unter 0 fallen.
- Die Ränge reichen von Anfänger (Level 1) bis Meister (Level 76–100). Die Ränge-Ansicht zeigt den aktuellen und den höchsten Rang sowie einen eigenen Rang pro Fach. Fach-XP kommen aus Lernzeit, Noten und erledigten Aufgaben.
- Wiederholte Abschlüsse und Quest-/Achievement-Belohnungen sind pro Datensatz bzw. Zeitraum gegen doppelte XP abgesichert.
