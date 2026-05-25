# iPad-Ausleihe

Offline-Desktop-App für die Verwaltung von iPad-Ausleihen an Schulen.

## Funktionen

- iPad-Inventar verwalten (Modell, Seriennummer, Status)
- Schüler mit Moin.Schule-Benutzername erfassen
- Ausleihe und Rückgabe mit automatischer PDF-Erstellung
- Drei Dokumenttypen: Mietvertrag, Rückgabebescheinigung, Verlust-/Defektanzeige
- Schullogo und Schulname konfigurierbar (für jede Schule nutzbar)
- Lokale SQLite-Datenbank (keine Internetverbindung nötig)
- Datenbankexport / -import für Backups

## Voraussetzungen (Entwicklung)

- Node.js 18 oder höher
- npm

## Installation (Entwicklung)

```bash
npm install
npm start
```

## App bauen (Installer)

```bash
# macOS (.dmg)
npm run build:mac

# Windows (.exe)
npm run build:win

# Beide Plattformen
npm run build:all
```

Die Installer befinden sich danach im Ordner `build/`.

## Datenspeicherung

Die Datenbank liegt unter:

- **macOS:** `~/Library/Application Support/iPad-Ausleihe/ipad-ausleihe.db`
- **Windows:** `%APPDATA%\iPad-Ausleihe\ipad-ausleihe.db`

Generierte PDFs werden unter `..../iPad-Ausleihe/documents/YYYY-MM/` gespeichert.

## PDF-Vorlagen anpassen

Die Dokumentvorlagen liegen in `renderer/templates/` als `.hbs`-Dateien (Handlebars HTML).
Sie enthalten den gesamten Text und das Layout der Dokumente und können direkt bearbeitet werden.

## Entwickelt mit

- [Electron](https://electronjs.org)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- [Handlebars](https://handlebarsjs.com)
- [Day.js](https://day.js.org)
