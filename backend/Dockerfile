FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV MCP_HTTP_PORT=7090
EXPOSE 7090

CMD ["node", "dist/server/http.js"]
