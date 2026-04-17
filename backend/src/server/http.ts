import "dotenv/config";
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createBaselineMcpServer } from "src/server/mcp-server";
import { BaselineService } from "src/app/service";
import { readPositiveInt } from "src/shared/utils";
import {
  subscribeBackplaneEvents,
  type BackplaneEvent,
} from "src/app/backplane-events";
import { createChatRouter } from "src/server/chat-routes";
import { createStudyRouter } from "src/study/routes";

type SessionContext = {
  transport: StreamableHTTPServerTransport;
  close: () => Promise<void>;
};

const app = express();
const port = readPositiveInt(process.env.MCP_HTTP_PORT, 7090);
const sessions = new Map<string, SessionContext>();
const adminService = new BaselineService();
const dataDir = process.env.MSL_DATA_DIR ?? ".msl-data";

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Chatendpunkt LLM über Vercel AI SDK an MCP und MSL
app.use(
  "/admin/chat",
  createChatRouter({
    service: adminService,
    mcpUrl: `http://127.0.0.1:${port}/mcp`,
  }),
);

app.use("/admin/study", createStudyRouter(dataDir, adminService));

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

app.get("/admin/config", async (_req, res) => {
  try {
    res.json(await adminService.getBackplaneConfig());
  } catch (error) {
    respondHttpError(res, 500, error);
  }
});

app.post("/admin/config", async (req, res) => {
  const patch = readBodyPatch(req.body);
  if (!patch) {
    respondHttpError(res, 400, "Request body must include a patch object.");
    return;
  }
  try {
    res.json(
      await adminService.updateBackplaneConfig({
        patch,
        actorId: readActorId(req.headers["x-msl-actor-id"]),
      }),
    );
  } catch (error) {
    respondHttpError(res, 400, error);
  }
});

app.get("/admin/queue", async (req, res) => {
  try {
    const limit = readQueryInt(req.query.limit, 300);
    const includeHistory = readQueryBoolean(req.query.includeHistory, false);
    const userToken = readQueryString(req.query.userToken);
    const result = await adminService.getGlobalQueue({ limit, includeHistory });

    if (userToken) {
      const filtered = result as Record<string, unknown>;
      const openPlans = (
        (filtered.openPlans ?? []) as Array<Record<string, unknown>>
      ).filter((p) => p.actorId === userToken);
      const historyPlans = (
        (filtered.historyPlans ?? []) as Array<Record<string, unknown>>
      ).filter((p) => p.actorId === userToken);
      res.json({
        ...filtered,
        openPlans,
        historyPlans,
        openCount: openPlans.length,
        historyCount: historyPlans.length,
        filteredByUserToken: userToken,
      });
    } else {
      res.json(result);
    }
  } catch (error) {
    respondHttpError(res, 500, error);
  }
});

app.get("/admin/sessions/:sessionId/queue", async (req, res) => {
  const sessionId = req.params.sessionId?.trim();
  if (!sessionId) {
    respondHttpError(res, 400, "sessionId is required");
    return;
  }
  try {
    const limit = readQueryInt(req.query.limit, 200);
    res.json(
      await adminService.getSessionQueue({
        sessionId,
        limit,
      }),
    );
  } catch (error) {
    respondHttpError(res, 500, error);
  }
});

app.get("/admin/plans/:planId", async (req, res) => {
  const planId = req.params.planId?.trim();
  if (!planId) {
    respondHttpError(res, 400, "planId is required");
    return;
  }
  try {
    res.json(await adminService.getPlan(planId));
  } catch (error) {
    respondHttpError(res, 500, error);
  }
});

app.get("/admin/plans/:planId/events", async (req, res) => {
  const planId = req.params.planId?.trim();
  if (!planId) {
    respondHttpError(res, 400, "planId is required");
    return;
  }
  try {
    res.json(await adminService.listPlanEvents(planId));
  } catch (error) {
    respondHttpError(res, 500, error);
  }
});

app.post("/admin/plans/:planId/approve", async (req, res) => {
  const planId = req.params.planId?.trim();
  if (!planId) {
    respondHttpError(res, 400, "planId is required");
    return;
  }
  try {
    res.json(
      await adminService.approvePlan({
        planId,
        reason: readBodyReason(req.body),
        actorId: readActorId(req.headers["x-msl-actor-id"]),
      }),
    );
  } catch (error) {
    respondHttpError(res, 500, error);
  }
});

app.post("/admin/plans/:planId/reject", async (req, res) => {
  const planId = req.params.planId?.trim();
  if (!planId) {
    respondHttpError(res, 400, "planId is required");
    return;
  }
  try {
    res.json(
      await adminService.rejectPlan({
        planId,
        reason: readBodyReason(req.body),
        actorId: readActorId(req.headers["x-msl-actor-id"]),
      }),
    );
  } catch (error) {
    respondHttpError(res, 500, error);
  }
});

app.post("/admin/plans/:planId/apply", async (req, res) => {
  const planId = req.params.planId?.trim();
  if (!planId) {
    respondHttpError(res, 400, "planId is required");
    return;
  }
  try {
    res.json(
      await adminService.applyPlan({
        planId,
      }),
    );
  } catch (error) {
    respondHttpError(res, 500, error);
  }
});

// FreeMode cleanen -> alle offenen plans als rejected markieren
// SutdyMode nutzt cleanupOpenPlans pro Session-Boundary der Endpunkt hier ist nur für manuell
app.post("/admin/plans/cleanup", async (req, res) => {
  try {
    const result = await adminService.cleanupOpenPlans({
      scope: "all",
      reason: readBodyReason(req.body) ?? "Manual cleanup via UI",
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    respondHttpError(res, 500, error);
  }
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

app.get("/admin/stream", async (req, res) => {
  const sessionId = readQueryString(req.query.sessionId);
  const snapshotLimit = readQueryInt(req.query.snapshotLimit, 200);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (event: string, data: unknown): void => {
    res.write(`id: ${Date.now()}\n`);
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const isVisibleForSubscriber = (event: BackplaneEvent): boolean => {
    if (!sessionId) {
      return true;
    }
    return event.sessionId === sessionId;
  };

  const unsubscribe = subscribeBackplaneEvents((event) => {
    if (!isVisibleForSubscriber(event)) {
      return;
    }
    send(event.eventType, event);
  });

  send("ready", {
    at: new Date().toISOString(),
    sessionId,
  });

  if (sessionId) {
    try {
      const snapshot = await adminService.getSessionQueue({
        sessionId,
        limit: snapshotLimit,
      });
      send("queue.snapshot", snapshot);
    } catch (error) {
      send("error", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
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

const readQueryString = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const first = value.find(
      (entry) => typeof entry === "string" && entry.trim().length > 0,
    );
    return typeof first === "string" ? first.trim() : undefined;
  }
  return undefined;
};

const readQueryInt = (value: unknown, fallback: number): number => {
  const raw = readQueryString(value);
  return readPositiveInt(raw, fallback);
};

const readQueryBoolean = (value: unknown, fallback: boolean): boolean => {
  const raw = readQueryString(value);
  if (!raw) {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  ) {
    return true;
  }
  if (
    normalized === "0" ||
    normalized === "false" ||
    normalized === "no" ||
    normalized === "off"
  ) {
    return false;
  }
  return fallback;
};

const readBodyReason = (body: unknown): string | undefined => {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const reasonRaw = (body as Record<string, unknown>).reason;
  if (typeof reasonRaw !== "string") {
    return undefined;
  }
  const normalized = reasonRaw.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const readBodyPatch = (body: unknown): Record<string, unknown> | undefined => {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  if (
    "patch" in body &&
    typeof (body as Record<string, unknown>).patch === "object"
  ) {
    const candidate = (body as Record<string, unknown>).patch;
    if (
      candidate &&
      typeof candidate === "object" &&
      !Array.isArray(candidate)
    ) {
      return candidate as Record<string, unknown>;
    }
    return undefined;
  }
  if (Array.isArray(body)) {
    return undefined;
  }
  return body as Record<string, unknown>;
};

const readHeaderString = (
  header: string | string[] | undefined,
): string | undefined => {
  if (typeof header === "string" && header.trim().length > 0)
    return header.trim();
  if (Array.isArray(header) && header.length > 0) return header[0]?.trim();
  return undefined;
};

const readActorId = (
  header: string | string[] | undefined,
): string | undefined => {
  const raw = getSessionId(header);
  if (!raw) {
    return undefined;
  }
  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : undefined;
};
