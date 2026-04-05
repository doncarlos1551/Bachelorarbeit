# Infrastructure

Lokale Lowcoder-Instanz, nginx-Vorlage und Postman-Collection.

## Inhalt

- `docker-compose.yml`: lokale Lowcoder-Instanz (Lowcoder + MongoDB)
- `nginx/`: Reverse-Proxy-Vorlage
- `postman/`: API-Collection plus Curl-Anleitung
- `DEPLOYMENT.md`: allgemeine Deployment Anleitung

## Lowcoder lokal starten

```bash
cd infrastructure
docker compose up -d
```

Lowcoder dann unter `http://localhost:3100`.

## Lowcoder API-Token

In der Lowcoder-UI erzeugen, dann in `backend/.env` als `LOWCODER_API_TOKEN` setzen.
