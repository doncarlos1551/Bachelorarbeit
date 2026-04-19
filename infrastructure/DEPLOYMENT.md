# Deployment

Grobe Anleitung für ein öffentliches VPS-Deployment: HTTPS via nginx vor Frontend, Backend und Lowcoder.

## Architektur

```text
HTTPS
  -> nginx
  -> Frontend SPA
  -> Backend API
  -> Lowcoder
```

## Routen

- `/`: Vue/Quasar SPA
- `/api/*`: Backend API
- `/lowcoder/*`: optionaler Lowcoder-Proxy

## Schutzmaßnahmen

- HTTPS
- Rate Limits für Chat und API
- Admin-Endpunkte serverseitig beschränken
- Kill-Switch für Missbrauchsfälle

## Build

```bash
cd backend
npm install
npm run seed
npm run mcp:http
```

```bash
cd frontend
npm install
npm run build
```

## nginx

```bash
sudo cp infrastructure/nginx/msl-platform.conf /etc/nginx/sites-available/msl
sudo ln -s /etc/nginx/sites-available/msl /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## Smoke Tests

```bash
curl https://study.example.de/
curl https://study.example.de/api/admin/health
```
