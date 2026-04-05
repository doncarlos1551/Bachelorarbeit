# MSL Backend

Serverseitige Logik des MCP Sandbox Layer. Stellt MCP-Tools für Lowcoder bereit, hält den Workspace-Kontext, persistiert Sessions und Pläne im SQLite-Store.

## Aufgaben

- HTTP-API für Frontend und Postman
- MCP-Server für Lowcoder-Tools (Read + Workspace-Context)
- Lowcoder-Adapter (Client, DSL, Dependency-Graph, DSL-Diff)
- SQLite-Persistenz für Sessions und Pläne

## Struktur

```text
src/server/      HTTP-Routen und MCP-Transport (http, stdio, mcp-server)
src/app/         BaselineService, Operations, Tool-Result, Backplane-Events
src/msl/         Config, Errors, Utils, Store, Subdomain-Interfaces
src/adapters/    Lowcoder-Client und DSL-Helper
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

## Endpunkte

- `GET /admin/health`: Health Check
- `GET /admin/projects`: Projekte aus Lowcoder lesen
- `GET /admin/context`: Workspace-Context lesen
- `POST /admin/context`: Workspace-Context setzen
- `GET /admin/mcp-sessions`: aktive MCP-Sessions
- `POST /mcp`, `GET /mcp`, `DELETE /mcp`: MCP HTTP-Transport

## Checks

```bash
npm run check
npm run lint
npm run format:check
```
