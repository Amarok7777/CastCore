Befunde (nach Schwere)

Prinzip 5 verletzt: OAuth-Tokens liegen unverschlüsselt auf Disk, nicht im Keychain/SafeStorage.
Laden und Speichern erfolgen direkt über JSON-Datei in authManager.js:9, authManager.js:36, authManager.js:46.
Das widerspricht direkt deiner Vorgabe zu Keychain bzw. verschlüsselter Speicherung.
Prinzip 4 verletzt: Port-Rollen sind nicht sauber getrennt.
Beide Server entstehen aus derselben Factory httpServer.js:95.
REST-State-Routen wie Timer-State liegen außerhalb des Dashboard-Blocks und damit effektiv auf beiden Ports, z.B. httpServer.js:1298.
Overlay-Port ist damit nicht rein statisch.
Prinzip 1 teilweise verletzt: Externe APIs werden nicht ausschließlich über dedizierte Services orchestriert.
Twitch/Google Fetch-Calls sitzen direkt in Routenlogik, z.B. Backfill und OAuth-Flows in httpServer.js:603, httpServer.js:712, httpServer.js:926, httpServer.js:981, YouTube Poll in httpServer.js:1186.
Dadurch bleibt die API-Integration nicht sauber gekapselt in einem Service-Layer.
Prinzip 3 teilweise verletzt: IPC-Kanäle sind Magic-Strings, keine zentrale Channel-Definition.
Kanäle werden mehrfach als Strings in Main und Preload gepflegt, z.B. index.js:358, preload.js:7, preload.js:7, main_index.js:172.
Eine zentrale Channel-Quelle fehlt; [shared/ipc-channels.ts] existiert aktuell nicht.
Stabilitätsrisiko im Auth-Fluss: YouTube-Refresh-Funktion ist definiert, aber nicht exportiert.
Definition in authManager.js:413.
Nutzung mit optional chaining in httpServer.js:1189.
Exportblock startet in authManager.js:532, Funktion fehlt dort. Ergebnis: Refresh kann stillschweigend nicht greifen.
Drift-Risiko durch doppelte Entry/Bridge-Dateien.
Aktive Main-Datei laut package.json:5 ist index.js, parallel existieren main_index.js und preload.js mit ähnlicher Logik.
Das erhöht Inkonsistenzgefahr bei Architektur-Regeln.
Konformitätsmatrix

Singleton-Services im Main Process: Teilweise erfüllt
Modulgrenzen und Kommunikation nur über Bus/IPC: Teilweise erfüllt
Preload als einzige Bridge + zentrale Channel-Konstanten: Teilweise erfüllt
Port 7331 statisch, 7332 API/WS: Nicht erfüllt
PKCE + sichere Token-Speicherung: Nicht erfüllt
Umbauplan (professionell, 2026-tauglich)

Architektur-Freeze und Zielvertrag definieren
Einen verbindlichen Vertrag für Port-Rollen, Service-Grenzen und IPC-Namensschema festziehen.
Altpfade als kompatible Fassade markieren, aber intern nicht mehr erweitern.
Auth-Service auf sichere Speicherung migrieren
Tokens aus Datei-JSON in sichere Speicherung migrieren (Keychain-first, SafeStorage-Fallback).
Migration beim Start: bestehende Tokens einmalig einlesen, verschlüsselt übernehmen, Klartext entfernen.
PKCE-Flow beibehalten, Refresh zentral im Auth-Service.
Server strikt trennen
7331 nur statische Auslieferung (Overlay-Dateien, keine State/Auth/Mutation-Routen).
7332 als einzige API/WS-Schicht für Timer, Chat, Alerts, OAuth.
Server Manager in Main hält beide Instanzen und Event-Routing zentral.
Externe API-Aufrufe vollständig in Services ziehen
TwitchService: OAuth-Token-Lifecycle, Helix-Calls, IRC/Chat Eventing.
YouTubeService: OAuth-Token-Lifecycle, Live-Discovery, Chat-Polling.
HTTP-Routen nur noch Input-Validation, Service-Call, Response-Mapping.
IPC-Kanäle zentralisieren
Eine einzige Channel-Definition einführen und Main/Preload darauf umstellen.
Danach String-Literale in IPC-Registrierung und Preload konsequent entfernen.
Duplikate in main_index.js und preload.js abbauen bzw. stilllegen.
Module auf klare Verantwortungen schneiden
Pro Modul: Handler-Registrierung, lokaler State, Service-Kommunikation.
Keine direkte Modul-zu-Modul-Aufrufe mehr; Ereignisse über IPC/Bus.
Schrittweise nach Domäne: Timer, Chat, Alerts, OBS, Music.
Abnahmekriterien und Tests
Security: kein Klartexttoken mehr in Datenverzeichnis.
Port-Policy: auf 7331 keine API-Endpunkte erreichbar.
IPC-Policy: keine IPC-Magic-Strings außerhalb zentraler Definition.
Runtime: jeweils nur eine aktive Verbindung pro externem Service.

Umsetzungsstand (Mai 2026)

Abgeschlossen

Phase 1
- Sichere OAuth-Speicherung via safeStorage + Migration von Klartextfeldern.
- Harte Port-Trennung: 7331 statisch-only, 7332 API/WS.

Phase 2
- Externe Provider-Calls aus der Routenebene in Singleton-Services verschoben.
- Twitch und YouTube API/OAuth-Flows laufen ueber dedizierte Service-Objekte.

Phase 3
- Zentrale IPC-Kanaldefinition in shared/ipc-channels.ts und shared/ipc-channels.js.
- Main/Preload auf Konstanten umgestellt, Magic-Strings entfernt.

Phase 4
- IPC-Registrierung modularisiert (Timer, Splits, Settings, App, TrackPulse).
- Main orchestriert nur noch den zentralen IPC-Registrar.

Phase 5
- Legacy-Doppelpfade stillgelegt via Kompatibilitaets-Shims:
	- main_index.js -> require('./main/index.js')
	- preload.js -> require('./main/preload.js')
- Server-Routen nach Domaene begonnen zu modularisieren:
	- coreStateRoutes kapselt Timer/Splits/Settings API.
	- httpServer bindet Domaenenmodul ein statt monolithischer Route-Definition.

Offen / Naechste Schritte

- Optional: dist-Artefakte neu bauen, damit Legacy-Strings in Build-Ausgabe verschwinden.
	- Hinweis: Build-Lauf gestartet, aktuell auf diesem Windows-System geblockt durch fehlende Symlink-Rechte beim Entpacken von winCodeSign (electron-builder Cache).