# MSL Backend

Serverseitige Logik des MCP Sandbox Layer. Nimmt Chat-Anfragen, stellt MCP-Tools für Lowcoder bereit, hält den Workspace-Kontext, persistiert Sessions, Pläne und Studiendaten im SQLite-Store.

## Aufgaben

- HTTP-API für Frontend und Postman
- MCP-Server für Lowcoder-Tools (Read + Workspace-Context)
- Chat-Routing über Vercel AI SDK mit MCP-Tool-Ausführung
- Lowcoder-Adapter (Client, DSL, Dependency-Graph, DSL-Diff)
- SQLite-Persistenz für Sessions, Pläne und Study-Daten
- Study-API: Sessions, Cases, Responses, Counterbalance, Export

## Struktur

```text
src/server/      HTTP-Routen, MCP-Transport und Chat-Router
src/app/         BaselineService, Operations, Tool-Result, Backplane-Events
src/msl/         Config, Errors, Utils, Store, Subdomain-Interfaces
src/adapters/    Lowcoder-Client und DSL-Helper
src/study/       Studienfälle, Sessions, Provisioning, Hooks-Interface
src/scripts/     Seed-Skript für das Lowcoder-Template
src/shared/      Hilfsfunktionen
```

## Setup

```bash
cp .env.example .env
npm install
npm run mcp:http
```

Wichtig in `.env`:

- `LOWCODER_BASE_URL`
- `LOWCODER_API_TOKEN`
- `OPENAI_API_KEY` oder `ANTHROPIC_API_KEY` (mindestens einer für Chat)

## Endpunkte

- `GET /admin/health`: Health Check
- `GET /admin/projects`: Projekte aus Lowcoder lesen
- `GET /admin/context`, `POST /admin/context`: Workspace-Context lesen und setzen
- `GET /admin/mcp-sessions`: aktive MCP-Sessions
- `POST /mcp`, `GET /mcp`, `DELETE /mcp`: MCP HTTP-Transport
- `POST /admin/chat`: Chat mit MCP-Tool-Ausführung über Vercel AI SDK Stream
- `/admin/study/*`: Study-Sessions, Cases, Responses, Export

## Checks

```bash
npm run check
npm run lint
npm run format:check
```
