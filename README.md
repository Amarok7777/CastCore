# CastCore

Lokale Streaming-Tool-Suite für OBS — Timer, Chat, Alerts, Musik und Automation in einer Electron-App.
SplitFlow (Speedrun Timer), ControlDeck, EventForge, ChatLink, ScenePilot, TrackPulse und FlowForge.

## Architektur

```
┌─────────────────────────────────────────────────────────────┐
│                     Electron App (lokal)                    │
│                                                             │
│  ┌──────────────┐   ┌────────────────┐   ┌──────────────┐   │
│  │ core/timer   │   │ core/splits    │   │core/settings │   │
│  │ State Machine│   │ Profilverwalt. │   │ Persistenz   │   │
│  └──────┬───────┘   └───────┬────────┘   └──────┬───────┘   │
│         │                   │                    │          │
│  ┌──────▼───────────────────▼────────────────────▼───────┐  │
│  │              server/ (Express + WS)                   │  │
│  │  Port 7331 → Overlay     Port 7332 → Dashboard        │  │
│  └──────────────────────────────────────────────────────-┘  │
│                                                             │
│  ┌──────────────────────┐    ┌──────────────────────────┐   │
│  │  server/hotkeys      │    │  main/ (Electron)        │   │
│  │  Globale Tastenkürzel│    │  Tray, IPC, Fenster      │   │
│  └──────────────────────┘    └──────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
  OBS Browser Source            Webbrowser
  localhost:7331                localhost:7332
  (Overlay-HTML)                (Dashboard)
```

## Tool Hub (neu)

Die App startet jetzt uber einen zentralen Hub auf Port `7332` und kann mehrere Tools verwalten.

- Startseite (Hub): `/` (Datei: `launcher/index.html`)
- Tool-Registry: `tools/registry.js`
- Tool-API: `GET /api/tools`
- SplitFlow Tool-Route: `/tool/splitflow`

So kannst du neue Tools spater erganzen:

1. Tool in `tools/registry.js` eintragen
2. Eine Route unter `/tool/<id>` im Server hinterlegen
3. Optional eigenes UI-Verzeichnis fur das Tool anlegen

Der Hub zeigt automatisch alle Eintrage aus der Registry an.

## Datenfluss

```
Hotkey/Button gedrückt
        │
        ▼
  timer.dispatch(action)       ← Einziger Einstiegspunkt für alle Aktionen
        │
        ▼
  Timer-State-Machine
  (idle → running → paused → finished)
        │
        ├─ emit('update', snapshot)
        │         │
        │         ▼
        │   WebSocket broadcast
        │         │
        │         ▼
        │   splitflow/overlay.html ← OBS sieht das sofort
        │
        └─ emit('stateChange')
                  │
                  ▼
            Tray-Menü aktualisieren
```

## Setup & Start

```bash
npm install
npm start          # Startet Electron + beide Server
```

## Plattformen (einfacher Modus)

Der Hub verwaltet Twitch und YouTube zentral uber Kanalname oder Handle.

So funktioniert es aktuell:

1. Im Hub den Twitch-Kanal oder YouTube-Handle eintragen
2. Auf `Verbinden` klicken
3. ChatLink und EventForge nutzen diese Konfiguration automatisch mit

Hinweise:

- Twitch verbindet sich direkt uber den angegebenen Kanalnamen
- YouTube versucht uber den angegebenen Kanal oder Handle den aktiven Livestream zu finden
- Wenn kein aktiver YouTube-Livestream gefunden wird, bleibt die Verbindung getrennt

## OBS einrichten

1. SplitFlow starten
2. In OBS: **Quelle hinzufügen → Browser**
3. URL: `http://localhost:7331/splitflow`
4. Breite: 280px, Höhe: 500px (je nach Splitanzahl anpassen)
5. **"Transparenz des Hintergrunds erlauben"** aktivieren

## Dateistruktur

```
splitflow/
├── launcher/
│   └── index.html      Startseite / Tool Hub (Auswahlseite)
├── tools/
│   └── registry.js     Tool-Katalog (Status, Route, Metadaten)
├── main/
│   ├── index.js        Electron-Hauptprozess, Tray, IPC
│   └── preload.js      Sichere IPC-Bridge für Dashboard-Renderer
├── server/
│   ├── index.js        Server-Bootstrap
│   ├── httpServer.js   Express (Overlay + Dashboard + REST API)
│   ├── wsServer.js     WebSocket — überträgt Timer-State an Overlay
│   ├── hotkeys.js      Globale Tastenkürzel via uiohook-napi
│   └── views/
│       └── auth.html    OAuth-Setup für Twitch und YouTube
├── core/
│   ├── timer.js        Timer-State-Machine (das Herzstück)
│   ├── splits.js       Profil-Verwaltung, LSS Import/Export
│   └── settings.js     Persistente Einstellungen
├── splitflow/
│   ├── index.html      SplitFlow Konfigurations-Oberfläche
│   └── overlay.html    OBS Browser Source — verbindet sich per WebSocket
├── legacy/
│   ├── shims/          Kompatibilitäts-Weiterleitungen
│   └── credentials/    Manuelle Setup-Dateien / Archiv
└── data/
    ├── settings.json   Gespeicherte Einstellungen
    └── splits/         Splits-Profile als .json
        └── super-mario-64-any.json
```

## Timer-Aktionen

| Aktion     | Standard-Hotkey | Beschreibung                         |
|------------|-----------------|--------------------------------------|
| start      | Numpad 1        | Starten / Nächster Split / Fortsetzen|
| pause      | Numpad 2        | Pausieren / Fortsetzen               |
| reset      | Numpad 3        | Zurücksetzen                         |
| undo       | Numpad 4        | Letzten Split rückgängig             |
| skip       | Numpad 5        | Aktuellen Split überspringen         |

## WebSocket-Protokoll

**Server → Client (Overlay):**
```json
{ "type": "SNAPSHOT", "payload": { ...snapshot } }
{ "type": "UPDATE",   "payload": { ...snapshot } }
```

**Client → Server (optional, für Overlay-Buttons):**
```json
{ "type": "ACTION", "action": "start" }
```

## Timer-Snapshot

```json
{
  "state":         "running",
  "currentSplit":  3,
  "elapsed":       284.732,
  "attempts":      47,
  "finishedCount": 12,
  "profile":       { "game": "...", "category": "..." },
  "segments": [
    {
      "name":      "Bob-omb Battlefield",
      "pb":        92.4,
      "gold":      88.1,
      "duration":  90.21,
      "skipped":   false,
      "isGold":    false,
      "splitTime": 90.21,
      "delta":     -2.19
    }
  ],
  "pbTotal":   847.8,
  "sobTotal":  806.3,
  "liveDelta": -1.4
}
```
