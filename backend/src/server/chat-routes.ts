import { Router } from "express";
import { streamText, stepCountIs } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { BaselineService } from "src/app/service";
import { isRecord } from "src/shared/utils";

// === System prompt ===

// @ToDo prompt muss deutsch
const BASE_SYSTEM_PROMPT = `You are an AI assistant that helps users build and modify Low-Code applications in Lowcoder via MCP tools.

Guidelines:
- Before modifying an existing component, call ui_list_components to confirm the current IDs.
- Create components before referencing them in bindings or actions.
- For mass changes (3+ similar operations), use apply_operations_batch in a single call — individual calls in a loop trigger the MSL rate-limit. The tool's JSON schema is authoritative: 'operations' is the top-level array of { kind, ... } objects. Call list_operation_kinds if unsure about the kinds.
- State awareness: after successful ui_rename_component / ui_remove_component / ui_add_component calls the component list HAS CHANGED. Before building a follow-up apply_operations_batch, FIRST call ui_list_components to refresh your view — otherwise the batch references stale IDs and is rejected as infeasible. Especially after the preflight rate-limit forced you into batch mode: list first, then batch ONLY the components that still need the change.
- A tool response with code "applied" or decision "approved" means the change is FINAL — the user has already seen risk info in the UI and explicitly confirmed where needed. Do NOT ask "should I proceed", do NOT paraphrase risk warnings as approval requests. Only a response with isError:true or decision "rejected"/"blocked" means the change did not apply; then explain why and ask how to continue.
- When implementing dynamic UI (click triggers external data → display): you need THREE parts working together — (1) a data source or JS query that fetches the data, (2) a binding on the display component that reads from the query result, (3) an onClick handler on the trigger button that runs the query. All three must exist or nothing is visible at runtime.
- Button onClick that should trigger a named Lowcoder query (one created via logic_upsert_function): call logic_set_component_action with actionType="executeQuery" and queryName="<that>". Do NOT use actionType="runScript" with scripts like "queryName()" or "queryName().then(...)" — Lowcoder queries are not plain JS functions, a bare call throws at runtime and the chain breaks. Component properties like imgSomething.src are read-only from runScript; rely on the mustache binding you placed on the display component.
- Component styling in Lowcoder lives under a nested "style" object on the component — never on top-level. Use propertyPath with a dot-path. Known style sub-keys (values are color names like "red", hex like "#ff0000", or CSS units like "3px"): style.background (background color), style.text (text color), style.borderColor, style.borderStyle, style.borderRadius, style.borderWidth, style.margin, style.padding, style.textSize, style.textWeight, style.fontFamily, style.fontStyle, style.textTransform, style.textDecoration, style.lineHeight, style.rotation. Example: to make the Logout button red, call ui_update_component_property with componentId="btnLogout", propertyPath="style.background", value="red". Do NOT invent top-level properties like "color", "backgroundColor", "style.background-color" — only the nested dot-path names above are recognized by Lowcoder.

Respond concisely in the user's language. After each tool call briefly confirm what was done.`;

const stringifyStreamError = (value: unknown): string => {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (value == null) return "Unknown error";
  if (isRecord(value)) {
    if (typeof value.message === "string") return value.message;
    if (typeof value.error === "string") return value.error;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "Unknown error";
  }
};

const OLLAMA_MODELS = new Set([
  "qwen2.5:7b",
  "qwen2.5:3b",
  "qwen3:4b",
  "llama3.2:3b",
  "llama3.1:8b",
  "mistral:7b",
  "codellama:7b",
]);

const ANTHROPIC_MODELS = new Set([
  "claude-sonnet-4-20250514",
  "claude-opus-4-20250514",
  "claude-haiku-4-20250506",
  "claude-3-5-sonnet-20241022",
]);

function resolveModel(modelId: string) {
  if (ANTHROPIC_MODELS.has(modelId) || modelId.startsWith("claude-")) {
    return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" })(
      modelId,
    );
  }
  if (OLLAMA_MODELS.has(modelId) || modelId.startsWith("ollama/")) {
    const ollamaBaseUrl =
      process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
    return createOpenAI({ apiKey: "ollama", baseURL: `${ollamaBaseUrl}/v1` })(
      modelId.replace("ollama/", ""),
    );
  }
  return createOpenAI({
    apiKey: process.env.OPENAI_API_KEY ?? process.env.LLM_API_KEY ?? "",
    baseURL: process.env.OPENAI_BASE_URL,
  })(modelId);
}

interface McpSession {
  vercelClient: MCPClient;
  rawClient: Client;
}

async function createMcpSession(mcpServerUrl: string): Promise<McpSession> {
  const vercelClient = await createMCPClient({
    transport: new StreamableHTTPClientTransport(new URL(mcpServerUrl)),
  });
  const rawTransport = new StreamableHTTPClientTransport(new URL(mcpServerUrl));
  const rawClient = new Client({ name: "chat-context-client", version: "1.0" });
  await rawClient.connect(rawTransport);
  return { vercelClient, rawClient };
}

export interface ChatRouterOptions {
  service: BaselineService;
  mcpUrl: string;
}

export function createChatRouter(options: ChatRouterOptions): Router {
  const router = Router();
  const { service, mcpUrl } = options;

  let session: McpSession | null = null;

  async function ensureSession(): Promise<McpSession> {
    if (session) return session;
    session = await createMcpSession(mcpUrl);
    console.log("[chat] MCP session ready");
    return session;
  }

  // POST /admin/chat, SSE Stream
  router.post("/", async (req, res) => {
    try {
      const body = readRequestBody(req.body);
      const message = readText(body.message);
      const projectId = readOptionalText(body.projectId);
      const modelId =
        readOptionalText(body.model) ?? process.env.LLM_CHAT_MODEL ?? "gpt-4o";
      const history = Array.isArray(body.history)
        ? body.history.filter(isChatHistoryEntry)
        : [];

      if (!message) {
        res.status(400).json({ ok: false, message: "message is required" });
        return;
      }

      const { vercelClient, rawClient } = await ensureSession();

      if (projectId) {
        await rawClient.callTool({
          name: "set_workspace_context",
          arguments: { projectId },
        });
      }

      const tools = await vercelClient.tools();
      console.log(
        "[chat] model:",
        modelId,
        "| project:",
        projectId ?? "(none)",
        "| tools:",
        Object.keys(tools).length,
      );

      let systemPrompt = BASE_SYSTEM_PROMPT;
      if (projectId) {
        try {
          const listing = await service.listComponents(projectId, 100);
          const components = Array.isArray(listing.components)
            ? listing.components.filter(isRecord)
            : [];
          if (components.length > 0) {
            const lines = components
              .map(
                (c) =>
                  `- ${c.componentId} (${c.componentType}${c.text ? `, text: "${c.text}"` : ""})`,
              )
              .join("\n");
            systemPrompt += `\n\nActive project: "${projectId}"\nComponents:\n${lines}\n\nUse these exact componentId values.`;
          } else {
            systemPrompt += `\n\nActive project: "${projectId}" (empty).`;
          }
        } catch {
          systemPrompt += `\n\nActive project: "${projectId}".`;
        }
      }

      const messages: Array<{ role: "user" | "assistant"; content: string }> = [
        ...history,
        { role: "user", content: message },
      ];

      // stream via UI Message Stream Protocol v6
      const result = streamText({
        model: resolveModel(modelId),
        system: systemPrompt,
        messages,
        tools,
        stopWhen: stepCountIs(15),
        temperature: 0,
        providerOptions: {
          anthropic: {
            cacheControl: { type: "ephemeral", ttl: "5m" },
          },
        },
        onFinish: ({ steps }) => {
          const toolCallCount = steps.reduce(
            (total, step) => total + (step.toolCalls?.length ?? 0),
            0,
          );
          console.log(
            "[chat] done:",
            steps.length,
            "steps,",
            toolCallCount,
            "tool calls",
          );
        },
      });

      result.pipeUIMessageStreamToResponse(res, {
        onError: (error) => stringifyStreamError(error),
      });
      return;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("[chat] Error:", errorMessage);
      if (!res.headersSent) {
        res.status(500).json({ ok: false, message: errorMessage });
      }
    }
  });

  // GET /admin/chat/models
  router.get("/models", async (_req, res) => {
    const hasOpenAI = !!(process.env.OPENAI_API_KEY ?? process.env.LLM_API_KEY);
    const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
    const ollamaBaseUrl =
      process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";

    let ollamaModels: Array<{ id: string; label: string; provider: string }> =
      [];
    try {
      const response = await fetch(`${ollamaBaseUrl}/api/tags`);
      if (response.ok) {
        const data = (await response.json()) as {
          models?: Array<{ name: string; size: number }>;
        };
        ollamaModels = (data.models ?? []).map((m) => ({
          id: m.name,
          label: `${m.name} (${(m.size / 1e9).toFixed(1)}GB)`,
          provider: "ollama",
        }));
      }
    } catch {
      // ollama optional
    }

    res.json({
      configured: hasOpenAI || hasAnthropic || ollamaModels.length > 0,
      defaultModel: process.env.LLM_CHAT_MODEL ?? "gpt-4o",
      suggestedModels: [
        ...(hasOpenAI
          ? [
              { id: "gpt-4o", label: "GPT-4o", provider: "openai" },
              { id: "gpt-4o-mini", label: "GPT-4o Mini", provider: "openai" },
            ]
          : []),
        ...(hasAnthropic
          ? [
              {
                id: "claude-sonnet-4-20250514",
                label: "Claude Sonnet 4",
                provider: "anthropic",
              },
            ]
          : []),
        ...ollamaModels,
      ],
    });
  });

  return router;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readRequestBody(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isChatHistoryEntry(
  value: unknown,
): value is { role: "user" | "assistant"; content: string } {
  return (
    isRecord(value) &&
    (value.role === "user" || value.role === "assistant") &&
    typeof value.content === "string"
  );
}
