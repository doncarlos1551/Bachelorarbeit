# Postman und Curl

API-Aufrufe für Smoke Tests und Studienadministration.

## Vorbereitung

- Backend, Frontend, Lowcoder gestartet
- Postman-Collection `MSL.postman_collection.json` importiert
- Collection-Variable `baseUrl` gesetzt (z. B. `http://127.0.0.1:7090`)

## Smoke Tests

```bash
curl http://127.0.0.1:7090/admin/health       # ok: true
curl http://127.0.0.1:7090/admin/config       # aktive Gate-Modi, Execution Mode
curl http://127.0.0.1:7090/admin/projects     # Lowcoder-Projekte
```

## Studien-Endpoints

```bash
curl http://127.0.0.1:7090/admin/study/cases     # C01 bis C08 mit Ground Truth
curl http://127.0.0.1:7090/admin/study/designs   # Counterbalance A, B, C
```

### Session anlegen

```bash
curl -X POST http://127.0.0.1:7090/admin/study/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "participantId": "P01",
    "participantGroup": "professional_dev",
    "counterbalanceDesignId": "A"
  }'
```

Response: `studySessionId`, optional `projectId`, Teilnehmer-URL.

### Case-Run starten

```bash
curl -X POST http://127.0.0.1:7090/admin/study/sessions/<studySessionId>/case-runs \
  -H "Content-Type: application/json" \
  -d '{ "caseId": "C01" }'
```

Response: `caseRunId`, aktive Variante.

### Response speichern

```bash
curl -X POST http://127.0.0.1:7090/admin/study/responses \
  -H "Content-Type: application/json" \
  -d '{
    "studySessionId": "<studySessionId>",
    "caseRunId": "<caseRunId>",
    "caseId": "C01",
    "variant": "summary",
    "trustRating": 4,
    "confidenceRating": 4,
    "transparencyRating": 4,
    "controlRating": 4
  }'
```

Skalen:

- Case-Ratings: 1 bis 7
- SUS: 1 bis 5
- Overall Trust: 1 bis 7
- Would Use: `yes`, `maybe`, `no`

### Export

```bash
curl http://127.0.0.1:7090/admin/study/export-all
curl http://127.0.0.1:7090/admin/study/export-all/csv
```

## Postman-Ordner

- `01 Ops`: Health, Config, Projekte, Queue
- `02 Study Flow`: Sessions, Case-Runs, Responses
- `03 Study Reporting`: Sessions, Exporte
- `04 Plans & Approval`: Plan-Details, Approve, Reject
- `05 Chat (LLM + MCP)`: Chat-Smoke-Test
- `06 Ablation (Gate-Konfiguration)`: Gate-Presets
- `07 Debug & Maintenance`: Projekt-Reset, Variant-Tracking
