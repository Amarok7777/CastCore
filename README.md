# CastCore

Lokale Streaming-Tool-Suite für Streamer — Timer, Chat, Alerts, Musik, Szenen und Automation in einer Electron-App.

> Alle Tools laufen vollständig lokal. Keine Cloud, keine Abonnements, keine externen Server.

---

## Tools

| Tool | Beschreibung |
|---|---|
| **SplitFlow** | Speedrun-Timer mit Splits, Bestzeiten und OBS Overlay |
| **ControlDeck** | Zentrale Stream-Schaltzentrale: OBS, Timer, Chat, Alerts, Musik |
| **EventForge** | Alert-System für Twitch/YouTube Events (Subs, Raids, Donations…) |
| **ChatLink** | Multi-Plattform Chat-Feed (Twitch + YouTube) mit Keywords & Highlights |
| **ScenePilot** | OBS Szenen-Steuerung, MIDI-Mapping, Virtual Camera |
| **TrackPulse** | Musik-Player mit OBS Now-Playing Overlay |
| **FlowForge** | Automation-Engine: Trigger → Bedingung → Aktion |
| **Widget URLs** | Generiert OBS Browser Source URLs für alle Overlays |

---

## Voraussetzungen

- [Node.js](https://nodejs.org/) 18+
- [OBS Studio](https://obsproject.com/) (optional, für OBS-Features)

---

## Setup

```bash
git clone https://github.com/Amarok7777/CastCore.git
cd CastCore
npm install
npm start
```

Der Hub öffnet sich unter `http://localhost:7332`.  
Overlays laufen auf `http://localhost:7331`.

---

## Twitch verbinden

CastCore hat eine eingebaute Twitch-App — kein Developer-Account nötig.

1. Hub öffnen → **Twitch** → Kanalnamen eingeben
2. **Mit Twitch einloggen** klicken
3. Code auf [twitch.tv/activate](https://twitch.tv/activate) eingeben

Optional: eigene Twitch-App unter **Einstellungen → Twitch App-Konfiguration**.

---

## OBS einrichten

Jedes Tool hat eine Overlay-URL. In OBS:  
**Quelle hinzufügen → Browser → URL eintragen**

| Overlay | URL |
|---|---|
| SplitFlow Timer | `http://localhost:7331/splitflow` |
| TrackPulse Now Playing | `http://localhost:7331/tool/trackpulse/overlay` |
| ChatLink Chat | `http://localhost:7331/tool/chatdeck/overlay` |
| EventForge Alerts | `http://localhost:7331/tool/alertdeck/overlay` |

Alle URLs auch unter **Widget URLs** im Hub.

---

## Architektur

```
┌─────────────────────────────────────────────────────┐
│                  Electron (main/)                   │
│           Tray · IPC · BrowserWindow                │
└───────────────────┬─────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
   Port 7331               Port 7332
   Overlay-Server          Dashboard-Server
   (OBS Browser Sources)   (Tool UIs + REST API)
        │                       │
        └───────────┬───────────┘
                    ▼
              WebSocket
          (Timer · Chat · Alerts · Musik)
```

**Kernmodule:**

```
core/          State-Machines (Timer, Splits, Settings, …)
server/        Express + WebSocket + REST API
main/          Electron-Hauptprozess
shared/        Design-System, i18n, Utilities
data/          Runtime-Daten (gitignored)
```

---

## Dateistruktur

```
CastCore/
├── main/              Electron-Hauptprozess + IPC
├── server/            Express-Server, REST-Routen, Services
├── core/              Zustandsverwaltung (Timer, Splits, Settings …)
├── shared/            Design-System, i18n (de/en), Utilities
├── tools/             Tool-Registry
├── launcher/          Hub-Startseite
├── splitflow/         SplitFlow-Tool (Timer + Overlay)
├── controldeck/       ControlDeck-Tool
├── alertdeck/         EventForge-Tool
├── chatdeck/          ChatLink-Tool
├── scenepilot/        ScenePilot-Tool
├── tunapilot/         TrackPulse-Tool
├── flowforge/         FlowForge-Tool
├── settings/          Einstellungen-Seite
├── widgeturls/        Widget-URL-Generator
└── docs/              Dokumentation
```

---

## Lokalisierung

Die App unterstützt Deutsch und Englisch.  
Sprache wechseln: Hub → Sprachumschalter (DE / EN).

Locale-Dateien: `shared/locales/de.json` · `shared/locales/en.json`

---

## SplitFlow Hotkeys

| Aktion | Standard |
|---|---|
| Start / Split / Fortsetzen | Numpad 1 |
| Pause | Numpad 2 |
| Reset | Numpad 3 |
| Undo Split | Numpad 4 |
| Split überspringen | Numpad 5 |

Hotkeys anpassen unter **Einstellungen → SplitFlow Hotkeys**.

---

## Build

```bash
npm run dist:win       # Windows NSIS Installer
npm run dist:portable  # Windows Portable
```
