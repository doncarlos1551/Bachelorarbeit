import { z } from "zod";

const GenericRecordSchema = z.record(z.unknown());
const OperationMetaSchema = z.object({
  userComment: z.string().min(1).max(1000).optional(),
});

const ComponentIdRefSchema = z
  .string()
  .min(1)
  .describe(
    "Bestehende Component-ID. Aktuelle IDs via 'ui_list_components' abrufen.",
  );
const PropertyPathSchema = z
  .string()
  .min(1)
  .describe(
    "Property-Pfad in der Komponente, z.B. 'comp.style.background' oder 'comp.disabled'.",
  );
const BindingExpressionSchema = z
  .string()
  .min(1)
  .describe(
    "Mustache-Ausdruck wie '{{ tempState.value }}' oder '{{ query.data }}'.",
  );
const HttpUrlSchema = z
  .string()
  .min(1)
  .describe(
    "Vollständige URL inklusive Protokoll, z.B. 'https://api.example.com/v1'.",
  );

export const UiAddComponentOperationSchema = z
  .object({
    kind: z.literal("ui.add_component"),
    pageId: z.string().min(1).default("page-main"),
    componentType: z
      .string()
      .min(1)
      .default("button")
      .describe(
        "Lowcoder-Komponententyp wie 'button', 'input', 'table', 'text'.",
      ),
    componentId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Optional: gewünschte ID für die neue Komponente. Sonst auto-generiert.",
      ),
    text: z.string().min(1).optional(),
    properties: GenericRecordSchema.default({}),
    events: GenericRecordSchema.default({}),
    x: z.number().int().nonnegative().optional(),
    y: z.number().int().nonnegative().optional(),
    w: z.number().int().positive().max(24).optional(),
    h: z.number().int().positive().max(24).optional(),
  })
  .merge(OperationMetaSchema);

export const UiUpdateComponentTextOperationSchema = z
  .object({
    kind: z.literal("ui.update_component_text"),
    componentId: ComponentIdRefSchema,
    text: z.string().min(1),
  })
  .merge(OperationMetaSchema);

export const UiUpdateComponentPropertyOperationSchema = z
  .object({
    kind: z.literal("ui.update_component_property"),
    componentId: ComponentIdRefSchema,
    propertyPath: PropertyPathSchema,
    value: z.unknown(),
  })
  .merge(OperationMetaSchema);

export const UiMoveComponentOperationSchema = z
  .object({
    kind: z.literal("ui.move_component"),
    componentId: ComponentIdRefSchema,
    x: z.number().int().nonnegative().optional(),
    y: z.number().int().nonnegative().optional(),
    w: z.number().int().positive().max(24).optional(),
    h: z.number().int().positive().max(24).optional(),
  })
  .merge(OperationMetaSchema);

export const UiRemoveComponentOperationSchema = z
  .object({
    kind: z.literal("ui.remove_component"),
    componentId: ComponentIdRefSchema,
  })
  .merge(OperationMetaSchema);

export const UiRenameComponentOperationSchema = z
  .object({
    kind: z.literal("ui.rename_component"),
    componentId: ComponentIdRefSchema,
    newComponentId: z
      .string()
      .min(1)
      .describe(
        "Neue Component-ID, muss im Projekt eindeutig sein (keine Kollision mit bestehenden IDs).",
      ),
  })
  .merge(OperationMetaSchema);

export const UiUpsertBindingOperationSchema = z
  .object({
    kind: z.literal("ui.upsert_binding"),
    componentId: ComponentIdRefSchema,
    bindingKey: z.string().min(1),
    expression: BindingExpressionSchema,
  })
  .merge(OperationMetaSchema);

export const UiRemoveBindingOperationSchema = z
  .object({
    kind: z.literal("ui.remove_binding"),
    componentId: ComponentIdRefSchema,
    bindingKey: z.string().min(1),
  })
  .merge(OperationMetaSchema);

export const LogicUpsertFunctionOperationSchema = z
  .object({
    kind: z.literal("logic.upsert_function"),
    functionId: z.string().min(1).optional(),
    functionName: z.string().min(1),
    code: z
      .string()
      .min(1)
      .describe(
        "JavaScript-Code der Query/Funktion. Muss einen Wert zurückgeben.",
      ),
  })
  .merge(OperationMetaSchema);

export const LogicSetComponentActionOperationSchema = z
  .object({
    kind: z.literal("logic.set_component_action"),
    componentId: ComponentIdRefSchema,
    actionName: z
      .string()
      .min(1)
      .default("onClick")
      .describe("Event-Handler-Name wie 'onClick', 'onChange', 'onSubmit'."),
    script: z
      .string()
      .min(1)
      .describe("JavaScript-Snippet oder Query-Aufruf wie 'queryName.run()'."),
    actionType: z.enum(["auto", "executeQuery", "runScript"]).default("auto"),
    queryName: z.string().min(1).optional(),
  })
  .merge(OperationMetaSchema);

export const IntegrationUpsertHttpDatasourceOperationSchema = z
  .object({
    kind: z.literal("integration.upsert_http_datasource"),
    datasourceId: z.string().min(1).optional(),
    name: z.string().min(1),
    method: z
      .string()
      .min(1)
      .default("GET")
      .describe("HTTP-Methode: 'GET', 'POST', 'PUT', 'DELETE', 'PATCH'."),
    url: HttpUrlSchema,
    headers: GenericRecordSchema.default({}),
    description: z.string().optional(),
  })
  .merge(OperationMetaSchema);

export const IntegrationBindComponentDatasourceOperationSchema = z
  .object({
    kind: z.literal("integration.bind_component_datasource"),
    componentId: ComponentIdRefSchema,
    datasourceId: z.string().min(1),
    mode: z.string().min(1).default("read"),
    mapping: GenericRecordSchema.default({}),
  })
  .merge(OperationMetaSchema);

export const StateUpsertTempStateOperationSchema = z
  .object({
    kind: z.literal("state.upsert_temp_state"),
    stateName: z.string().min(1),
    value: z.unknown().default({}),
  })
  .merge(OperationMetaSchema);

export const PreloadAddJsLibraryOperationSchema = z
  .object({
    kind: z.literal("preload.add_js_library"),
    url: HttpUrlSchema,
  })
  .merge(OperationMetaSchema);

export const PreloadRemoveJsLibraryOperationSchema = z
  .object({
    kind: z.literal("preload.remove_js_library"),
    url: HttpUrlSchema,
  })
  .merge(OperationMetaSchema);

export const PreloadSetScriptOperationSchema = z
  .object({
    kind: z.literal("preload.set_script"),
    script: z.string().default(""),
  })
  .merge(OperationMetaSchema);

export const PreloadSetCssOperationSchema = z
  .object({
    kind: z.literal("preload.set_css"),
    css: z.string().default(""),
  })
  .merge(OperationMetaSchema);

export const PreloadSetGlobalCssOperationSchema = z
  .object({
    kind: z.literal("preload.set_global_css"),
    css: z.string().default(""),
  })
  .merge(OperationMetaSchema);

export const BaselineOperationSchema = z.discriminatedUnion("kind", [
  UiAddComponentOperationSchema,
  UiUpdateComponentTextOperationSchema,
  UiUpdateComponentPropertyOperationSchema,
  UiMoveComponentOperationSchema,
  UiRemoveComponentOperationSchema,
  UiRenameComponentOperationSchema,
  UiUpsertBindingOperationSchema,
  UiRemoveBindingOperationSchema,
  LogicUpsertFunctionOperationSchema,
  LogicSetComponentActionOperationSchema,
  IntegrationUpsertHttpDatasourceOperationSchema,
  IntegrationBindComponentDatasourceOperationSchema,
  StateUpsertTempStateOperationSchema,
  PreloadAddJsLibraryOperationSchema,
  PreloadRemoveJsLibraryOperationSchema,
  PreloadSetScriptOperationSchema,
  PreloadSetCssOperationSchema,
  PreloadSetGlobalCssOperationSchema,
]);

export type BaselineOperation = z.infer<typeof BaselineOperationSchema>;

//Map für apply_operations_batch zum gleicht LLM-Kurzformen aus
const KIND_ALIASES: Record<string, string> = {
  rename: "ui.rename_component",
  add: "ui.add_component",
  remove: "ui.remove_component",
  delete: "ui.remove_component",
  move: "ui.move_component",
  updateText: "ui.update_component_text",
  update_text: "ui.update_component_text",
  updateProperty: "ui.update_component_property",
  update_property: "ui.update_component_property",
  upsertFunction: "logic.upsert_function",
  upsert_function: "logic.upsert_function",
  setAction: "logic.set_component_action",
  set_action: "logic.set_component_action",
  upsertDatasource: "integration.upsert_http_datasource",
  bindDatasource: "integration.bind_component_datasource",
  upsertTempState: "state.upsert_temp_state",
  addLibrary: "preload.add_js_library",
  removeLibrary: "preload.remove_js_library",
  setScript: "preload.set_script",
  setCss: "preload.set_css",
  setGlobalCss: "preload.set_global_css",
};

const normalizeKinds = (input: unknown): unknown => {
  if (typeof input !== "object" || input === null) return input;
  const record = input as Record<string, unknown>;
  const ops = record.operations;
  if (!Array.isArray(ops)) return input;
  const normalizedOps = ops.map((op) => {
    if (typeof op !== "object" || op === null) return op;
    const opRecord = op as Record<string, unknown>;
    const kind = opRecord.kind;
    if (typeof kind === "string" && kind in KIND_ALIASES) {
      return { ...opRecord, kind: KIND_ALIASES[kind] };
    }
    return op;
  });
  return { ...record, operations: normalizedOps };
};

export const OperationsBatchSchema = z.object({
  projectId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  chatId: z.string().min(1).optional(),
  userComment: z.string().min(1).max(1000).optional(),
  operations: z.array(BaselineOperationSchema).min(1),
});

export const normalizeBatchInput = normalizeKinds;

export const ListProjectsSchema = z.object({
  limit: z.number().int().positive().max(500).default(100),
  search: z.string().optional(),
});

export const CreateProjectSchema = z.object({
  projectName: z.string().min(3),
});

export const ProjectSummarySchema = z.object({
  projectId: z.string().min(1).optional(),
});

export const ProjectInspectSchema = z.object({
  projectId: z.string().min(1).optional(),
  componentId: z.string().min(1).optional(),
  includeRawDsl: z.boolean().default(false),
});

export const ListComponentsSchema = z.object({
  projectId: z.string().min(1).optional(),
  limit: z.number().int().positive().max(1000).default(200),
});

export const SetWorkspaceContextSchema = z
  .object({
    projectId: z.string().min(1).optional(),
    actorId: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    chatId: z.string().min(1).optional(),
  })
  .refine(
    (value) =>
      Boolean(
        value.projectId || value.actorId || value.sessionId || value.chatId,
      ),
    {
      message: "At least one field is required",
    },
  );
