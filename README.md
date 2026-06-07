# CastCore

Local streaming tool suite for streamers — timer, chat, alerts, music, scenes and automation in one Electron app.

> Everything runs fully local. No cloud, no subscriptions, no external servers.

---

## Tools

| Tool | Description |
|---|---|
| **SplitFlow** | Speedrun timer with splits, personal bests and OBS overlay |
| **ControlDeck** | Central stream dashboard: OBS, timer, chat, alerts, music |
| **EventForge** | Alert system for Twitch/YouTube events (subs, raids, donations…) |
| **ChatLink** | Multi-platform chat feed (Twitch + YouTube) with keywords & highlights |
| **ScenePilot** | OBS scene control, MIDI mapping, virtual camera |
| **TrackPulse** | Music player with OBS now-playing overlay |
| **FlowForge** | Automation engine: trigger → condition → action |
| **Widget URLs** | Generates OBS browser source URLs for all overlays |

---

## Requirements

- [Node.js](https://nodejs.org/) 18+
- [OBS Studio](https://obsproject.com/) (optional, for OBS features)

---

## Setup

```bash
git clone https://github.com/Amarok7777/CastCore.git
cd CastCore
npm install
npm start
```

The hub opens at `http://localhost:7332`.  
Overlays run on `http://localhost:7331`.

---

## Connecting Twitch

CastCore ships with a built-in Twitch app — no developer account needed.

1. Open the hub → **Twitch** → enter your channel name
2. Click **Login with Twitch**
3. Enter the code at [twitch.tv/activate](https://twitch.tv/activate)

Optional: use your own Twitch app under **Settings → Twitch App Configuration**.

---

## OBS Setup

Every tool has an overlay URL. In OBS:  
**Add Source → Browser → enter URL**

| Overlay | URL |
|---|---|
| SplitFlow Timer | `http://localhost:7331/splitflow` |
| TrackPulse Now Playing | `http://localhost:7331/tool/trackpulse/overlay` |
| ChatLink Chat | `http://localhost:7331/tool/chatdeck/overlay` |
| EventForge Alerts | `http://localhost:7331/tool/alertdeck/overlay` |

All URLs are also available under **Widget URLs** in the hub.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Electron (main/)                   │
│           Tray · IPC · BrowserWindow                │
└───────────────────┬─────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
   Port 7331               Port 7332
   Overlay server          Dashboard server
   (OBS browser sources)   (Tool UIs + REST API)
        │                       │
        └───────────┬───────────┘
                    ▼
              WebSocket
          (timer · chat · alerts · music)
```

**Core modules:**

```
core/          State machines (timer, splits, settings, …)
server/        Express + WebSocket + REST API
main/          Electron main process
shared/        Design system, i18n, utilities
data/          Runtime data (gitignored)
```

---

## File Structure

```
CastCore/
├── main/              Electron main process + IPC
├── server/            Express server, REST routes, services
├── core/              State management (timer, splits, settings …)
├── shared/            Design system, i18n (de/en), utilities
├── tools/             Tool registry
├── launcher/          Hub landing page
├── splitflow/         SplitFlow tool (timer + overlay)
├── controldeck/       ControlDeck tool
├── alertdeck/         EventForge tool
├── chatdeck/          ChatLink tool
├── scenepilot/        ScenePilot tool
├── tunapilot/         TrackPulse tool
├── flowforge/         FlowForge tool
├── settings/          Settings page
├── widgeturls/        Widget URL generator
└── docs/              Documentation
```

---

## Localization

The app supports German and English.  
Switch language: hub → language switcher (DE / EN).

Locale files: `shared/locales/de.json` · `shared/locales/en.json`

---

## SplitFlow Hotkeys

| Action | Default |
|---|---|
| Start / Split / Resume | Numpad 1 |
| Pause | Numpad 2 |
| Reset | Numpad 3 |
| Undo split | Numpad 4 |
| Skip split | Numpad 5 |

Customize hotkeys under **Settings → SplitFlow Hotkeys**.

---

## Build

```bash
npm run dist:win       # Windows NSIS installer
npm run dist:portable  # Windows portable
```
