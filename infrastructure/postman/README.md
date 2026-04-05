# Postman und Curl

API-Aufrufe für Smoke Tests.

## Vorbereitung

- Backend starten (`npm run mcp:http` aus `backend/`)
- Postman-Collection `MSL.postman_collection.json` importieren
- Collection-Variable `baseUrl` setzen (z. B. `http://127.0.0.1:7090`)

## Smoke Tests

Entweder per Postman oder per shell mit curl:

```bash
curl http://127.0.0.1:7090/admin/health     # ok: true
curl http://127.0.0.1:7090/admin/projects   # Lowcoder-Projekte
curl http://127.0.0.1:7090/admin/context    # aktueller Workspace-Context
```

## Postman-Ordner

- `01 Ops`: Health, Projects, Context
