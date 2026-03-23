import "dotenv/config";
import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/admin/health", (_req, res) => {
  res.json({
    ok: true,
    service: "mcp-baseline-admin-backplane",
    now: new Date().toISOString(),
  });
});

const port = Number(process.env.MCP_HTTP_PORT ?? 7090);
app.listen(port, () => {
  console.log(`[mcp-baseline] http endpoint on http://0.0.0.0:${port}`);
});
