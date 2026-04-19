# MCP Sandbox Layer

Forschungsprototyp zur Bachelorarbeit **Konzeption und Evaluation eines MCP Sandbox Layers zur Trust-Kalibrierung bei LLM-gestützten Änderungen in Low-Code-Plattformen**.

Das **MCP Sandbox Layer (MSL)** sitzt zwischen Chat-Modell, MCP-Tools und Lowcoder und prüft LLM-Änderungen vor der Ausführung.

## Ziel

- LLM-generierte Tool-Aufrufe prüfbar machen
- riskante Änderungen vor der Ausführung erkennen
- Nutzerfreigabe für relevante Fälle erzwingen
- Änderungen für eine Studie reproduzierbar protokollieren

## Gate-Pipeline

1. **Preflight**: Batch-Konsistenz, Rate-Limit und Locks
2. **Policy**: formale Grenzen, z. B. Operationstypen und Payload-Größe
3. **Validation**: strukturelle Fehler
4. **Diff**: Änderung gegen Baseline
5. **Risk**: Risikobewertung der Operationen
6. **Approval**: Nutzerfreigabe falls nötig
7. **Audit**: Entscheidung und Kontext protokollieren

## Bestandteile

### Frontend

- Vue-Arbeitsoberfläche mit Quasar-Komponenten
- Chat-Seitenleiste
- MSL-Status, Diff und Freigabe-Dialoge
- Studienmodus mit Aufgaben, Ratings und Abschlussfragebogen

### Backend

- Express-HTTP-Server
- MCP-Server für Lowcoder-Tools
- MSL-Gate-Pipeline
- SQLite-Persistenz für Plans, Sessions und Studienantworten

### Lowcoder-Adapter

- Zugriff auf Lowcoder-Projekte
- Lesen und Schreiben der Application-DSL
- strukturelle Diffs und Abhängigkeitsanalyse

### Studienmodul

- Cases C01 bis C08
- Counterbalance-Designs A, B und C
- Varianten `summary`, `diff` und `diff_risk`
- Postman-Collection für Smoke Tests und Studienadministration

## Repository-Struktur

```text
backend/          MSL-Backend mit MCP-Server und Study-API
frontend/         Vue-Workspace mit Quasar-Komponenten
infrastructure/   Docker-Compose, nginx-Vorlage, Postman-Collection
```

## Schnellstart

### Voraussetzungen

- Node.js 20 oder höher
- Docker mit Docker Compose
- Lowcoder API-Token
- optional: API-Key für OpenAI oder Anthropic

### Lowcoder starten

```bash
cd infrastructure
docker compose up -d
```

Lowcoder ist danach lokal unter `http://localhost:3100` erreichbar.

### Backend starten

```bash
cd backend
cp .env.example .env
npm install
npm run seed
npm run mcp:http
```

Das Backend läuft standardmässig auf Port `7090`.

### Frontend starten

```bash
cd frontend
npm install
npm run dev
```

Das Frontend läuft standardmässig auf Port `9200`.

## Zentrale Konfiguration

Die vollständige Backend-Konfiguration steht in [backend/.env.example](backend/.env.example).

Wichtige Variablen:

- `LOWCODER_BASE_URL`: URL der Lowcoder-Instanz
- `LOWCODER_API_TOKEN`: API-Token für Lowcoder
- `OPENAI_API_KEY`: optionaler OpenAI-Zugang
- `ANTHROPIC_API_KEY`: optionaler Anthropic-Zugang
- `MSL_STORE_BACKEND`: Persistenzmodus, z. B. `sqlite`
- `MSL_EXECUTION_MODE`: automatische oder manuelle Ausführung
- `MSL_GATE_*_MODE`: Gate-Modi `off`, `observe` oder `enforce`

## Studienmodus

Vorbereitet für die Trust-Studie:

- Case-Ratings: 1 bis 7
- SUS-Abschlussfragebogen: 1 bis 5
- Overall Trust: 1 bis 7
- Nutzungsbereitschaft: `yes`, `maybe`, `no`

API-Aufrufe für Smoke Tests und Studienadministration: [infrastructure/postman/README.md](infrastructure/postman/README.md).

## Qualitätskontrolle

```bash
cd backend
npm run check
npm run lint
```

```bash
cd frontend
npm run lint
npm run build
```

Hinweis: Forschungsartefakt, nicht produktionsreif.

## Lizenz

MIT, siehe [LICENSE](LICENSE).
