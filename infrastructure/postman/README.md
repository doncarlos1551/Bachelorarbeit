# Postman und Curl

API-Aufrufe für Smoke Tests.

## Vorbereitung

- Backend starten (`npm run mcp:http` aus `backend/`)
- Postman-Collection `MSL.postman_collection.json` importieren
- Collection-Variable `baseUrl` setzen (z. B. `http://127.0.0.1:7090`)

## Smoke Tests

Entweder per Postman oder per shell mit curl:

```bash
curl http://127.0.0.1:7090/admin/health           # ok: true
curl http://127.0.0.1:7090/admin/projects         # Lowcoder-Projekte
curl http://127.0.0.1:7090/admin/context          # aktueller Workspace-Context
curl http://127.0.0.1:7090/admin/study/cases      # C01 bis C08 mit Ground Truth
curl http://127.0.0.1:7090/admin/study/designs    # Counterbalance A, B, C
```

## Postman-Ordner

- `01 Ops`: Health, Projects, Context, Config, Queue
- `02 Study Flow`: Sessions, Case-Runs, Responses
- `03 Study Reporting`: Sessions, Exporte
- `05 Chat (LLM und MCP)`: Chat-Smoke-Test
