import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  CreateProjectSchema,
  ListComponentsSchema,
  ListProjectsSchema,
  ProjectInspectSchema,
  ProjectSummarySchema,
  SetWorkspaceContextSchema,
} from "src/app/operations";
import type { BaselineService } from "src/app/service";
import {
  createErrorToolResult,
  createSuccessToolResult,
} from "src/app/tool-result";

const UiGetComponentToolSchema = z.object({
  projectId: z.string().min(1).optional(),
  componentId: z.string().min(1),
});

export const createBaselineMcpServer = (
  service: BaselineService,
): McpServer => {
  const server = new McpServer(
    {
      name: "mcp-baseline",
      version: "0.2.0",
    },
    {
      capabilities: { logging: {} },
      instructions:
        "Du bist mit einem Lowcoder-MCP-Server verbunden. Nutze set_workspace_context um ein Projekt auszuwählen, dann die Read-Tools (list_projects, project_summary, ui_list_components, ui_get_component, project_inspect_dsl) zur Inspektion.",
    },
  );

  registerTool(
    server,
    "get_workspace_context",
    {
      description: "Liest den aktuellen Arbeitskontext (projectId, actorId).",
    },
    async () => {
      return formatSuccess("get_workspace_context", "Workspace context", {
        context: service.getWorkspaceContext(),
      });
    },
  );

  registerTool(
    server,
    "set_workspace_context",
    {
      description:
        "Setzt den Arbeitskontext (projectId/actorId/sessionId/chatId). Wenn projectId fehlt, greifen folgende Tools auf den zuletzt gesetzten Kontext zu.",
      inputSchema: SetWorkspaceContextSchema,
    },
    async (input) => {
      const request = SetWorkspaceContextSchema.parse(input);
      return formatSuccess(
        "set_workspace_context",
        "Workspace context updated",
        {
          context: service.setWorkspaceContext(request),
        },
      );
    },
  );

  registerTool(
    server,
    "list_projects",
    {
      description: "Listet vorhandene Projekte in Lowcoder.",
      inputSchema: ListProjectsSchema,
    },
    async (input) => {
      const request = ListProjectsSchema.parse(input);
      return formatSuccess(
        "list_projects",
        "Project list",
        await service.listProjects(request.limit, request.search),
      );
    },
  );

  registerTool(
    server,
    "create_project",
    {
      description:
        "Erstellt ein neues Lowcoder-Projekt und setzt es automatisch als aktiven Kontext.",
      inputSchema: CreateProjectSchema,
    },
    async (input) => {
      const request = CreateProjectSchema.parse(input);
      return formatSuccess(
        "create_project",
        "Project created",
        await service.createProject(request.projectName),
      );
    },
  );

  registerTool(
    server,
    "project_summary",
    {
      description:
        "Liefert eine kompakte Projektzusammenfassung (Komponenten/Funktionen/Datasources).",
      inputSchema: ProjectSummarySchema,
    },
    async (input) => {
      const request = ProjectSummarySchema.parse(input);
      return formatSuccess(
        "project_summary",
        "Project summary",
        await service.projectSummary(request.projectId),
      );
    },
  );

  registerTool(
    server,
    "project_inspect_dsl",
    {
      description:
        "Liest DSL-Details für Verifikation (Bindings, onEvent-Handler, Queries/Funktionen). Optional mit raw DSL.",
      inputSchema: ProjectInspectSchema,
    },
    async (input) => {
      const request = ProjectInspectSchema.parse(input);
      return formatSuccess(
        "project_inspect_dsl",
        "Project DSL inspection",
        await service.inspectDsl(request.projectId, {
          componentId: request.componentId,
          includeRawDsl: request.includeRawDsl,
        }),
      );
    },
  );

  registerTool(
    server,
    "ui_list_components",
    {
      description:
        "Listet alle UI-Komponenten inklusive IDs im aktuellen Projekt.",
      inputSchema: ListComponentsSchema,
    },
    async (input) => {
      const request = ListComponentsSchema.parse(input);
      return formatSuccess(
        "ui_list_components",
        "UI components",
        await service.listComponents(request.projectId, request.limit),
      );
    },
  );

  registerTool(
    server,
    "ui_get_component",
    {
      description:
        "Gibt Details einer einzelnen Komponente zurück: componentType und alle " +
        "aktuellen Properties (inkl. bestehender '{{...}}'-Expressions).",
      inputSchema: UiGetComponentToolSchema,
    },
    async (input) => {
      const request = UiGetComponentToolSchema.parse(input);
      return formatSuccess(
        "ui_get_component",
        `Component ${request.componentId} inspection`,
        await service.inspectDsl(request.projectId, {
          componentId: request.componentId,
        }),
      );
    },
  );

  return server;
};

const registerTool = (
  server: McpServer,
  name: string,
  config: Record<string, unknown>,
  handler: (...args: unknown[]) => Promise<unknown> | unknown,
): void => {
  server.registerTool(
    name,
    config as Parameters<typeof server.registerTool>[1],
    (async (...args: unknown[]) => {
      try {
        return await handler(...args);
      } catch (error) {
        return createErrorToolResult(name, error);
      }
    }) as Parameters<typeof server.registerTool>[2],
  );
};

const formatSuccess = (
  tool: string,
  title: string,
  payload: Record<string, unknown>,
) => createSuccessToolResult(tool, title, payload);
