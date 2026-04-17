import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodIssue } from "zod";
import type { SchemaIssue } from "src/msl/gates/gates.interfaces";
import type { BaselineOperation } from "src/app/operations";
import {
  BaselineOperationSchema,
  CreateProjectSchema,
  IntegrationBindComponentDatasourceOperationSchema,
  IntegrationUpsertHttpDatasourceOperationSchema,
  ListComponentsSchema,
  ListProjectsSchema,
  LogicSetComponentActionOperationSchema,
  LogicUpsertFunctionOperationSchema,
  OperationsBatchSchema,
  normalizeBatchInput,
  PreloadAddJsLibraryOperationSchema,
  PreloadRemoveJsLibraryOperationSchema,
  PreloadSetCssOperationSchema,
  PreloadSetGlobalCssOperationSchema,
  PreloadSetScriptOperationSchema,
  ProjectInspectSchema,
  ProjectSummarySchema,
  StateUpsertTempStateOperationSchema,
  SetWorkspaceContextSchema,
  UiAddComponentOperationSchema,
  UiMoveComponentOperationSchema,
  UiRemoveComponentOperationSchema,
  UiRenameComponentOperationSchema,
  UiUpdateComponentPropertyOperationSchema,
  UiUpdateComponentTextOperationSchema,
} from "src/app/operations";
import type { BaselineService } from "src/app/service";
import {
  createErrorToolResult,
  createSuccessToolResult,
} from "src/app/tool-result";

// Operation-Schema zu MCP-Tool-Schema:
// - kind und userComment raus (kind kommt vom Tool-Namen, userComment ist intern)
// - projectId optional dazu (resolves via Workspace-Context)
const STRIP_OPERATION_FIELDS = { kind: true, userComment: true } as const;
const PROJECT_ID_FIELD = {
  projectId: z.string().min(1).optional(),
} as const;

const UiAddComponentToolSchema = UiAddComponentOperationSchema.omit(
  STRIP_OPERATION_FIELDS,
).extend(PROJECT_ID_FIELD);
const UiUpdateComponentTextToolSchema =
  UiUpdateComponentTextOperationSchema.omit(STRIP_OPERATION_FIELDS).extend(
    PROJECT_ID_FIELD,
  );
const UiUpdateComponentPropertyToolSchema =
  UiUpdateComponentPropertyOperationSchema.omit(STRIP_OPERATION_FIELDS).extend(
    PROJECT_ID_FIELD,
  );
const UiMoveComponentToolSchema = UiMoveComponentOperationSchema.omit(
  STRIP_OPERATION_FIELDS,
).extend(PROJECT_ID_FIELD);
const UiRemoveComponentToolSchema = UiRemoveComponentOperationSchema.omit(
  STRIP_OPERATION_FIELDS,
).extend(PROJECT_ID_FIELD);
const UiRenameComponentToolSchema = UiRenameComponentOperationSchema.omit(
  STRIP_OPERATION_FIELDS,
).extend(PROJECT_ID_FIELD);
const UiGetComponentToolSchema = z.object({
  projectId: z.string().min(1).optional(),
  componentId: z.string().min(1),
});
const LogicUpsertFunctionToolSchema = LogicUpsertFunctionOperationSchema.omit(
  STRIP_OPERATION_FIELDS,
).extend(PROJECT_ID_FIELD);
const LogicSetComponentActionToolSchema =
  LogicSetComponentActionOperationSchema.omit(STRIP_OPERATION_FIELDS).extend(
    PROJECT_ID_FIELD,
  );
const IntegrationUpsertHttpDatasourceToolSchema =
  IntegrationUpsertHttpDatasourceOperationSchema.omit(
    STRIP_OPERATION_FIELDS,
  ).extend(PROJECT_ID_FIELD);
const IntegrationBindComponentDatasourceToolSchema =
  IntegrationBindComponentDatasourceOperationSchema.omit(
    STRIP_OPERATION_FIELDS,
  ).extend(PROJECT_ID_FIELD);
const StateUpsertTempStateToolSchema = StateUpsertTempStateOperationSchema.omit(
  STRIP_OPERATION_FIELDS,
).extend(PROJECT_ID_FIELD);
const PreloadAddJsLibraryToolSchema = PreloadAddJsLibraryOperationSchema.omit(
  STRIP_OPERATION_FIELDS,
).extend(PROJECT_ID_FIELD);
const PreloadRemoveJsLibraryToolSchema =
  PreloadRemoveJsLibraryOperationSchema.omit(STRIP_OPERATION_FIELDS).extend(
    PROJECT_ID_FIELD,
  );
const PreloadSetScriptToolSchema = PreloadSetScriptOperationSchema.omit(
  STRIP_OPERATION_FIELDS,
).extend(PROJECT_ID_FIELD);
const PreloadSetCssToolSchema = PreloadSetCssOperationSchema.omit(
  STRIP_OPERATION_FIELDS,
).extend(PROJECT_ID_FIELD);
const PreloadSetGlobalCssToolSchema = PreloadSetGlobalCssOperationSchema.omit(
  STRIP_OPERATION_FIELDS,
).extend(PROJECT_ID_FIELD);
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
        "Du bist mit einem Lowcoder-MCP-Server verbunden. Nutze set_workspace_context um ein Projekt auszuwählen, dann die UI/Logic/Integration/State/Preload-Tools um Änderungen vorzunehmen. Jede Änderung wird serverseitig durch den MSL Sandbox Layer bewertet — du hast KEINEN Zugriff auf MSL-Konfiguration oder Plan-Genehmigungen. Wenn eine Operation blockiert wird, erhältst du eine Fehlermeldung mit dem Grund.",
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
        "aktuellen Properties (inkl. bestehender '{{…}}'-Expressions). Vor einem " +
        "gezielten property-Edit empfohlen, um nicht blind zu überschreiben.",
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

  registerTool(
    server,
    "ui_add_component",
    {
      description:
        "Fügt eine UI-Komponente hinzu (button/input/text/select/table/container). Optional mit properties/events/position.",
      inputSchema: UiAddComponentToolSchema,
    },
    async (input) => {
      const request = UiAddComponentToolSchema.parse(input);
      const result = await service.applyOperations({
        projectId: request.projectId,
        operations: [{ kind: "ui.add_component", ...request }],
        mcpCall: { name: "ui_add_component", args: request },
      });
      const assignedId = extractComponentId(result);
      return formatSuccess(
        "ui_add_component",
        assignedId ? `Component '${assignedId}' added` : "Component added",
        result,
      );
    },
  );

  registerTool(
    server,
    "ui_update_component_text",
    {
      description:
        "Ändert den sichtbaren Text/Label einer vorhandenen Komponente.",
      inputSchema: UiUpdateComponentTextToolSchema,
    },
    async (input) => {
      const request = UiUpdateComponentTextToolSchema.parse(input);
      return formatSuccess(
        "ui_update_component_text",
        "Component text updated",
        await service.applyOperations({
          projectId: request.projectId,
          operations: [{ kind: "ui.update_component_text", ...request }],
          mcpCall: { name: "ui_update_component_text", args: request },
        }),
      );
    },
  );

  registerTool(
    server,
    "ui_update_component_property",
    {
      description:
        "Setzt eine Property (propertyPath) auf einer Komponente. " +
        "value darf ein Literal sein (string, number, boolean, object, array) " +
        "ODER eine Lowcoder-Expression in Mustache-Syntax: '{{currentCustomer.value.legalName}}'. " +
        "Auch Text mit eingebetteten Platzhaltern ist erlaubt: 'Hallo {{user.name}}!'. " +
        "WICHTIG: Mustache-Klammern müssen balanciert sein, keine Verschachtelung " +
        "('{{ {{x}} }}' ist ungültig). Dieses Tool ersetzt die früheren " +
        "ui_upsert_binding / ui_remove_binding — ein reaktiver Wert ist einfach " +
        "ein Property-Wert mit {{…}}. Zum Inspizieren der aktuellen Properties " +
        "bitte 'ui_get_component' verwenden.",
      inputSchema: UiUpdateComponentPropertyToolSchema,
    },
    async (input) => {
      const request = UiUpdateComponentPropertyToolSchema.parse(input);
      return formatSuccess(
        "ui_update_component_property",
        "Component property updated",
        await service.applyOperations({
          projectId: request.projectId,
          operations: [{ kind: "ui.update_component_property", ...request }],
          mcpCall: { name: "ui_update_component_property", args: request },
        }),
      );
    },
  );

  registerTool(
    server,
    "ui_move_component",
    {
      description: "Verschiebt oder resized eine Komponente (x/y/w/h).",
      inputSchema: UiMoveComponentToolSchema,
    },
    async (input) => {
      const request = UiMoveComponentToolSchema.parse(input);
      return formatSuccess(
        "ui_move_component",
        "Component moved",
        await service.applyOperations({
          projectId: request.projectId,
          operations: [{ kind: "ui.move_component", ...request }],
          mcpCall: { name: "ui_move_component", args: request },
        }),
      );
    },
  );

  registerTool(
    server,
    "ui_remove_component",
    {
      description: "Entfernt eine Komponente aus Layout und Item-Registry.",
      inputSchema: UiRemoveComponentToolSchema,
    },
    async (input) => {
      const request = UiRemoveComponentToolSchema.parse(input);
      return formatSuccess(
        "ui_remove_component",
        "Component removed",
        await service.applyOperations({
          projectId: request.projectId,
          operations: [{ kind: "ui.remove_component", ...request }],
          mcpCall: { name: "ui_remove_component", args: request },
        }),
      );
    },
  );

  registerTool(
    server,
    "ui_rename_component",
    {
      description: "Benennt eine Komponente auf eine neue componentId um.",
      inputSchema: UiRenameComponentToolSchema,
    },
    async (input) => {
      const request = UiRenameComponentToolSchema.parse(input);
      return formatSuccess(
        "ui_rename_component",
        "Component renamed",
        await service.applyOperations({
          projectId: request.projectId,
          operations: [{ kind: "ui.rename_component", ...request }],
          mcpCall: { name: "ui_rename_component", args: request },
        }),
      );
    },
  );

  // === Bindings sind keine eigenen Tools mehr, über ui_update_component_property ===
  // ui.upsert_binding und ui.remove_binding bleiben im Domain-Modell für Replay

  registerTool(
    server,
    "logic_upsert_function",
    {
      description:
        "Legt eine Funktion an oder aktualisiert sie (functionName, code).",
      inputSchema: LogicUpsertFunctionToolSchema,
    },
    async (input) => {
      const request = LogicUpsertFunctionToolSchema.parse(input);
      return formatSuccess(
        "logic_upsert_function",
        "Function upserted",
        await service.applyOperations({
          projectId: request.projectId,
          operations: [{ kind: "logic.upsert_function", ...request }],
          mcpCall: { name: "logic_upsert_function", args: request },
        }),
      );
    },
  );

  registerTool(
    server,
    "logic_set_component_action",
    {
      description:
        "Verknüpft eine Component Action (z.B. onClick eines Buttons) mit Logik. " +
        "WICHTIG — handler type in Lowcoder: " +
        "'executeQuery' (Run a Data Query) triggert eine benannte JS-Query, " +
        "aktualisiert deren .data und re-evaluiert alle {{queryName.data...}}-Bindings " +
        "— das ist der richtige Weg für UI-Updates. " +
        "'runScript' (Run a JavaScript) führt inline JS aus; " +
        "imperatives component.value = ... ist in Lowcoder NICHT reaktiv. " +
        "Setze für Query-Trigger: actionType='executeQuery' und queryName='fetchPokemon'. " +
        "Für echte JS-Logik: actionType='runScript'. " +
        "Default 'auto': einfache Query-Calls werden erkannt, komplexere Scripts als runScript behandelt.",
      inputSchema: LogicSetComponentActionToolSchema,
    },
    async (input) => {
      const request = LogicSetComponentActionToolSchema.parse(input);
      return formatSuccess(
        "logic_set_component_action",
        "Component action updated",
        await service.applyOperations({
          projectId: request.projectId,
          operations: [{ kind: "logic.set_component_action", ...request }],
          mcpCall: { name: "logic_set_component_action", args: request },
        }),
      );
    },
  );

  registerTool(
    server,
    "integration_upsert_http_datasource",
    {
      description:
        "Legt eine HTTP-Datasource an oder aktualisiert sie (Name, URL, Methode, Header).",
      inputSchema: IntegrationUpsertHttpDatasourceToolSchema,
    },
    async (input) => {
      const request = IntegrationUpsertHttpDatasourceToolSchema.parse(input);
      return formatSuccess(
        "integration_upsert_http_datasource",
        "HTTP datasource upserted",
        await service.applyOperations({
          projectId: request.projectId,
          operations: [
            { kind: "integration.upsert_http_datasource", ...request },
          ],
          mcpCall: {
            name: "integration_upsert_http_datasource",
            args: request,
          },
        }),
      );
    },
  );

  registerTool(
    server,
    "integration_bind_component_datasource",
    {
      description:
        "Verknüpft eine Komponente mit einer Datasource und optionalem Mapping.",
      inputSchema: IntegrationBindComponentDatasourceToolSchema,
    },
    async (input) => {
      const request = IntegrationBindComponentDatasourceToolSchema.parse(input);
      return formatSuccess(
        "integration_bind_component_datasource",
        "Component datasource binding updated",
        await service.applyOperations({
          projectId: request.projectId,
          operations: [
            { kind: "integration.bind_component_datasource", ...request },
          ],
          mcpCall: {
            name: "integration_bind_component_datasource",
            args: request,
          },
        }),
      );
    },
  );

  registerTool(
    server,
    "state_upsert_temp_state",
    {
      description:
        "Legt einen Temporary State an oder aktualisiert seinen Initialwert.",
      inputSchema: StateUpsertTempStateToolSchema,
    },
    async (input) => {
      const request = StateUpsertTempStateToolSchema.parse(input);
      return formatSuccess(
        "state_upsert_temp_state",
        "Temp state upserted",
        await service.applyOperations({
          projectId: request.projectId,
          operations: [{ kind: "state.upsert_temp_state", ...request }],
          mcpCall: { name: "state_upsert_temp_state", args: request },
        }),
      );
    },
  );

  registerTool(
    server,
    "preload_add_js_library",
    {
      description:
        "Fügt eine externe JavaScript-Library-URL im Preload-Bereich hinzu (JavaScript Library).",
      inputSchema: PreloadAddJsLibraryToolSchema,
    },
    async (input) => {
      const request = PreloadAddJsLibraryToolSchema.parse(input);
      return formatSuccess(
        "preload_add_js_library",
        "Preload JS library added",
        await service.applyOperations({
          projectId: request.projectId,
          operations: [{ kind: "preload.add_js_library", ...request }],
          mcpCall: { name: "preload_add_js_library", args: request },
        }),
      );
    },
  );

  registerTool(
    server,
    "preload_remove_js_library",
    {
      description:
        "Entfernt eine JavaScript-Library-URL aus dem Preload-Bereich.",
      inputSchema: PreloadRemoveJsLibraryToolSchema,
    },
    async (input) => {
      const request = PreloadRemoveJsLibraryToolSchema.parse(input);
      return formatSuccess(
        "preload_remove_js_library",
        "Preload JS library removed",
        await service.applyOperations({
          projectId: request.projectId,
          operations: [{ kind: "preload.remove_js_library", ...request }],
          mcpCall: { name: "preload_remove_js_library", args: request },
        }),
      );
    },
  );

  registerTool(
    server,
    "preload_set_script",
    {
      description:
        "Setzt den Preload-JavaScript-Code (JavaScript Library -> Scripts and Styles -> JavaScript).",
      inputSchema: PreloadSetScriptToolSchema,
    },
    async (input) => {
      const request = PreloadSetScriptToolSchema.parse(input);
      return formatSuccess(
        "preload_set_script",
        "Preload script updated",
        await service.applyOperations({
          projectId: request.projectId,
          operations: [{ kind: "preload.set_script", ...request }],
          mcpCall: { name: "preload_set_script", args: request },
        }),
      );
    },
  );

  registerTool(
    server,
    "preload_set_css",
    {
      description: "Setzt das lokale Preload-CSS (nur App-spezifischer Stil).",
      inputSchema: PreloadSetCssToolSchema,
    },
    async (input) => {
      const request = PreloadSetCssToolSchema.parse(input);
      return formatSuccess(
        "preload_set_css",
        "Preload CSS updated",
        await service.applyOperations({
          projectId: request.projectId,
          operations: [{ kind: "preload.set_css", ...request }],
          mcpCall: { name: "preload_set_css", args: request },
        }),
      );
    },
  );

  registerTool(
    server,
    "preload_set_global_css",
    {
      description:
        "Setzt globales Preload-CSS (globalCSS), das app-weit wirkt.",
      inputSchema: PreloadSetGlobalCssToolSchema,
    },
    async (input) => {
      const request = PreloadSetGlobalCssToolSchema.parse(input);
      return formatSuccess(
        "preload_set_global_css",
        "Preload global CSS updated",
        await service.applyOperations({
          projectId: request.projectId,
          operations: [{ kind: "preload.set_global_css", ...request }],
          mcpCall: { name: "preload_set_global_css", args: request },
        }),
      );
    },
  );

  registerTool(
    server,
    "apply_operations_batch",
    {
      description:
        "Führt mehrere Operationen in EINEM Aufruf aus. PFLICHT für " +
        "Massenänderungen (ab 3 gleichartigen Ops), sonst greift das " +
        "Preflight-Rate-Limit. " +
        "ARGUMENT-SHAPE (Pflichtfeld 'operations' ist ein Array am TOP-LEVEL): " +
        '{ "operations": [ { "kind": "ui.rename_component", "componentId": "btnA", "newComponentId": "btn_a" }, ' +
        '{ "kind": "ui.rename_component", "componentId": "btnB", "newComponentId": "btn_b" } ] }. ' +
        "NICHT verschachteln (kein { input: { operations: ... } } oder { args: { operations: ... } }). " +
        "Jede Operation MUSS ein 'kind' haben, einer der vollen Namen: " +
        "'ui.add_component', 'ui.update_component_text', 'ui.update_component_property', " +
        "'ui.move_component', 'ui.remove_component', 'ui.rename_component', " +
        "'logic.upsert_function', 'logic.set_component_action', " +
        "'integration.upsert_http_datasource', 'integration.bind_component_datasource', " +
        "'state.upsert_temp_state', 'preload.add_js_library', 'preload.remove_js_library', " +
        "'preload.set_script', 'preload.set_css', 'preload.set_global_css'. " +
        "Kurzformen wie 'rename' / 'updateText' werden normalisiert, volle Namen bevorzugen.",
      inputSchema: OperationsBatchSchema,
    },
    async (input) => {
      // Envelope strikt parsen, Operations per-operation safeParse
      // schema-OK-Operations laufen weiter durch MSL, schema-failed sammeln Errors
      // LLM sieht alle Probleme in einer Antwort statt nacheinander
      // @ToDo Konsistenz: "per-op" -> "per-operation", "Ops" -> "Operations"
      const normalized = normalizeBatchInput(input);
      const envelope = OperationsBatchEnvelopeSchema.parse(normalized);
      const parsedOperations: BaselineOperation[] = [];
      const operationIndexes: number[] = [];
      const schemaIssues: SchemaIssue[] = [];
      envelope.operations.forEach((rawOperation, originalIndex) => {
        const result = BaselineOperationSchema.safeParse(rawOperation);
        if (result.success) {
          parsedOperations.push(result.data);
          operationIndexes.push(originalIndex);
          return;
        }
        schemaIssues.push({
          operationIndex: originalIndex,
          opKind: extractRawOperationKind(rawOperation),
          errors: result.error.issues.map(formatPerOpZodIssue),
        });
      });

      const mcpArgs: Record<string, unknown> = {
        operations: envelope.operations,
      };
      if (envelope.projectId) mcpArgs.projectId = envelope.projectId;
      if (envelope.sessionId) mcpArgs.sessionId = envelope.sessionId;
      if (envelope.chatId) mcpArgs.chatId = envelope.chatId;
      if (envelope.userComment) mcpArgs.userComment = envelope.userComment;
      return formatSuccess(
        "apply_operations_batch",
        "Batch operations applied",
        await service.applyOperations({
          projectId: envelope.projectId,
          sessionId: envelope.sessionId,
          chatId: envelope.chatId,
          userComment: envelope.userComment,
          operations: parsedOperations,
          operationIndexes,
          schemaIssues,
          // mcpCall in PlanMetadata setzen sonst filtert polling vom frontend den plan weg
          mcpCall: { name: "apply_operations_batch", args: mcpArgs },
        }),
      );
    },
  );

  registerTool(
    server,
    "list_operation_kinds",
    {
      description:
        "Listet alle unterstützten operation kinds für apply_operations_batch.",
    },
    async () => {
      return formatSuccess("list_operation_kinds", "Operation kinds", {
        kinds: supportedOperationKinds,
      });
    },
  );

  return server;
};

const supportedOperationKinds: string[] = [
  "ui.add_component",
  "ui.update_component_text",
  "ui.update_component_property",
  "ui.move_component",
  "ui.remove_component",
  "ui.rename_component",
  "ui.upsert_binding",
  "ui.remove_binding",
  "logic.upsert_function",
  "logic.set_component_action",
  "integration.upsert_http_datasource",
  "integration.bind_component_datasource",
  "state.upsert_temp_state",
  "preload.add_js_library",
  "preload.remove_js_library",
  "preload.set_script",
  "preload.set_css",
  "preload.set_global_css",
];

const extractComponentId = (
  result: Record<string, unknown>,
): string | undefined => {
  const steps = result.steps as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(steps) || steps.length === 0) return undefined;
  const componentId = steps[0].componentId;
  return typeof componentId === "string" ? componentId : undefined;
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

void BaselineOperationSchema;

// Envelope ohne PerOperationSchema um peroperations safeParse zu erlauben
// einzelne defekte Operation blockiert nicht restliche errors
const OperationsBatchEnvelopeSchema = z.object({
  projectId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  chatId: z.string().min(1).optional(),
  userComment: z.string().min(1).max(1000).optional(),
  operations: z.array(z.unknown()).min(1),
});

const formatPerOpZodIssuePath = (issue: ZodIssue): string => {
  if (issue.path.length === 0) return "(root)";
  return issue.path
    .map((segment) => (typeof segment === "number" ? `[${segment}]` : segment))
    .join(".")
    .replace(/\.\[/g, "[");
};

const formatPerOpZodIssue = (issue: ZodIssue): string =>
  `${formatPerOpZodIssuePath(issue)}: ${issue.message}`;

const extractRawOperationKind = (rawOperation: unknown): string => {
  if (
    rawOperation &&
    typeof rawOperation === "object" &&
    "kind" in rawOperation &&
    typeof (rawOperation as { kind: unknown }).kind === "string"
  ) {
    return (rawOperation as { kind: string }).kind;
  }
  return "unknown";
};
