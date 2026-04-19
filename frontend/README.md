# MSL Frontend

Arbeitsoberfläche des Prototyps: Lowcoder, Chat-Assistent und MSL-Bewertung in einer Ansicht. Im Studienmodus mit Tasks, Ratings und Abschlussfragebogen.

## Modi

### `free`

- Zweck: freies Arbeiten mit Lowcoder und Chat
- URL-Beispiel: `?mode=free`

### `study`

- Zweck: Studienablauf mit Consent, Tasks, Ratings und Abschlussdialog
- URL-Beispiel: `?mode=study&session=<sessionId>`

## Struktur

```text
src/layouts/       Seitenlayout
src/pages/         WorkspacePage als Hauptansicht
src/components/    Dialoge und TopBar
src/composables/   wiederverwendbare Frontend-Logik
src/features/      API-Clients und Feature-Typen
src/router/        Routen und Guards
src/utils/         kleine Hilfsfunktionen
```

## Stack

- Vue 3 + TypeScript, Composition API
- Quasar-Komponenten
- Scoped SCSS, BEM-artige Klassen
- State über Composables

## Setup

```bash
npm install
npm run dev
```

Dev-Server: Port `9200`.

## Build und Lint

```bash
npm run lint
npm run build
```

## Umgebungsvariablen

- `VITE_MSL_BACKPLANE_BASE_URL`: Backend-URL (Default `/api`)
- `VITE_LOWCODER_BASE_URL`: Lowcoder-URL (Default `http://<host>:3100`)
