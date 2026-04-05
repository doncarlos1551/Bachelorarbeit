import "dotenv/config";
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createBaselineMcpServer } from "src/server/mcp-server";
import { BaselineService } from "src/app/service";
import { readPositiveInt } from "src/shared/utils";

type SessionContext = {
  transport: StreamableHTTPServerTransport;
  close: () => Promise<void>;
};

const app = express();
const port = readPositiveInt(process.env.MCP_HTTP_PORT, 7090);
const sessions = new Map<string, SessionContext>();
const adminService = new BaselineService();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/admin/health", (_req, res) => {
  res.json({
    ok: true,
    service: "mcp-baseline-admin-backplane",
    now: new Date().toISOString(),
  });
});

app.get("/admin/projects", async (_req, res) => {
  try {
    const projects = await adminService.listProjects(200);
    res.json({ ok: true, projects });
  } catch (error) {
    respondHttpError(res, 500, error);
  }
});

app.get("/admin/context", (_req, res) => {
  res.json({ ok: true, context: adminService.getWorkspaceContext() });
});

app.post("/admin/context", (req, res) => {
  const { projectId, actorId, sessionId, chatId } = req.body as Record<
    string,
    unknown
  >;
  const ctx = adminService.setWorkspaceContext({
    ...(typeof projectId === "string" ? { projectId } : {}),
    ...(typeof actorId === "string" ? { actorId } : {}),
    ...(typeof sessionId === "string" ? { sessionId } : {}),
    ...(typeof chatId === "string" ? { chatId } : {}),
  });
  res.json({ ok: true, context: ctx });
});

app.get("/admin/mcp-sessions", (_req, res) => {
  const activeSessions = [...sessions.entries()].map(([id]) => ({
    sessionId: id,
    connectedAt: new Date().toISOString(), // @ToDo connectiontime!
  }));
  const context = adminService.getWorkspaceContext();
  res.json({
    ok: true,
    activeMcpSessions: activeSessions.length,
    sessions: activeSessions,
    currentContext: context,
  });
});

app.post("/mcp", async (req, res) => {
  const sessionId = getSessionId(req.headers["mcp-session-id"]);

  try {
    if (sessionId) {
      const existing = sessions.get(sessionId);
      if (!existing) {
        respondMcpError(res, 404, "Session not found");
        return;
      }
      await existing.transport.handleRequest(req, res, req.body);
      return;
    }

    if (!isInitializeRequest(req.body)) {
      respondMcpError(res, 400, "Initialization required before using /mcp");
      return;
    }

    // muss gleiche Instanz wie AdminAPI sonst geht ProjectLock nicht
    const userToken = readHeaderString(req.headers["x-msl-user-token"]);
    if (userToken) {
      adminService.setWorkspaceContext({ actorId: userToken });
    }

    const server = createBaselineMcpServer(adminService);
    let closed = false;
    // eslint-disable-next-line prefer-const -- transport wird in closures vor der initialisierung referenziert
    let transport: StreamableHTTPServerTransport;

    const closeSession = async () => {
      if (closed) {
        return;
      }
      closed = true;
      const sid = transport.sessionId;
      if (sid) {
        sessions.delete(sid);
      }
      await transport.close();
      await server.close();
    };

    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (createdSessionId) => {
        sessions.set(createdSessionId, {
          transport,
          close: closeSession,
        });
      },
    });

    transport.onclose = () => {
      if (closed) {
        return;
      }
      closed = true;
      const sid = transport.sessionId;
      if (sid) {
        sessions.delete(sid);
      }
      void server.close();
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    respondMcpError(
      res,
      500,
      error instanceof Error ? error.message : "Internal MCP error",
    );
  }
});

app.get("/mcp", async (req, res) => {
  const sessionId = getSessionId(req.headers["mcp-session-id"]);
  if (!sessionId) {
    respondMcpError(res, 400, "Missing MCP session ID");
    return;
  }
  const existing = sessions.get(sessionId);
  if (!existing) {
    respondMcpError(res, 404, "Session not found");
    return;
  }
  try {
    await existing.transport.handleRequest(req, res);
  } catch (error) {
    respondMcpError(
      res,
      500,
      error instanceof Error
        ? error.message
        : "Failed to handle MCP GET request",
    );
  }
});

app.delete("/mcp", async (req, res) => {
  const sessionId = getSessionId(req.headers["mcp-session-id"]);
  if (!sessionId) {
    respondMcpError(res, 400, "Missing MCP session ID");
    return;
  }
  const existing = sessions.get(sessionId);
  if (!existing) {
    respondMcpError(res, 404, "Session not found");
    return;
  }
  try {
    await existing.transport.handleRequest(req, res);
  } catch (error) {
    respondMcpError(
      res,
      500,
      error instanceof Error
        ? error.message
        : "Failed to terminate MCP session",
    );
  }
});

app.listen(port, "0.0.0.0", () => {
  console.log(
    `[mcp-baseline] streamable endpoint ready on http://0.0.0.0:${port}/mcp`,
  );
});

const getSessionId = (
  header: string | string[] | undefined,
): string | undefined => {
  if (!header) {
    return undefined;
  }
  return Array.isArray(header) ? header[0] : header;
};

const respondMcpError = (
  res: express.Response,
  status: number,
  message: string,
): void => {
  if (res.headersSent) {
    return;
  }
  res.status(status).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message,
    },
    id: null,
  });
};

const respondHttpError = (
  res: express.Response,
  status: number,
  error: unknown,
): void => {
  if (res.headersSent) {
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  res.status(status).json({
    ok: false,
    message,
  });
};

const readHeaderString = (
  header: string | string[] | undefined,
): string | undefined => {
  if (typeof header === "string" && header.trim().length > 0)
    return header.trim();
  if (Array.isArray(header) && header.length > 0) return header[0]?.trim();
  return undefined;
};
