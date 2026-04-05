import { isRecord, slugify, type JsonRecord } from "src/shared/utils";
import type { BaselineOperation } from "src/app/operations";

interface ComponentRef {
  nodeId: string;
  item: JsonRecord;
}

const readStringValue = (value: unknown, fallback = ""): string => {
  return typeof value === "string" ? value : fallback;
};

const readFiniteNumber = (value: unknown, fallback: number): number => {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

export interface ApplyOperationResult {
  nextDsl: JsonRecord;
  details: Record<string, unknown>;
}

export const applyOperationToApplicationDsl = (
  applicationDslInput: JsonRecord,
  operation: BaselineOperation,
): ApplyOperationResult => {
  switch (operation.kind) {
    case "ui.add_component":
      return addComponentToApplicationDsl(applicationDslInput, operation);
    case "ui.update_component_text":
      return updateComponentTextInApplicationDsl(
        applicationDslInput,
        operation,
      );
    case "ui.update_component_property":
      return updateComponentPropertyInApplicationDsl(
        applicationDslInput,
        operation,
      );
    case "ui.move_component":
      return moveComponentInApplicationDsl(applicationDslInput, operation);
    case "ui.remove_component":
      return removeComponentInApplicationDsl(applicationDslInput, operation);
    case "ui.rename_component":
      return renameComponentInApplicationDsl(applicationDslInput, operation);
    case "ui.upsert_binding":
      return upsertBindingInApplicationDsl(applicationDslInput, operation);
    case "ui.remove_binding":
      return removeBindingInApplicationDsl(applicationDslInput, operation);
    case "logic.upsert_function":
      return upsertFunctionInApplicationDsl(applicationDslInput, operation);
    case "logic.set_component_action":
      return setComponentActionInApplicationDsl(applicationDslInput, operation);
    case "integration.upsert_http_datasource":
      return upsertHttpDatasourceInApplicationDsl(
        applicationDslInput,
        operation,
      );
    case "integration.bind_component_datasource":
      return bindComponentDatasourceInApplicationDsl(
        applicationDslInput,
        operation,
      );
    case "state.upsert_temp_state":
      return upsertTempStateInApplicationDsl(applicationDslInput, operation);
    case "preload.add_js_library":
      return addJsLibraryToApplicationDsl(applicationDslInput, operation);
    case "preload.remove_js_library":
      return removeJsLibraryFromApplicationDsl(applicationDslInput, operation);
    case "preload.set_script":
      return setPreloadScriptInApplicationDsl(applicationDslInput, operation);
    case "preload.set_css":
      return setPreloadCssInApplicationDsl(applicationDslInput, operation);
    case "preload.set_global_css":
      return setPreloadGlobalCssInApplicationDsl(
        applicationDslInput,
        operation,
      );
    default: {
      const exhaustive: never = operation;
      throw new Error(
        `Unsupported operation kind ${(exhaustive as { kind?: string }).kind ?? "unknown"}`,
      );
    }
  }
};

export const summarizeApplicationDsl = (
  applicationDsl: JsonRecord,
): Record<string, unknown> => {
  const ui = isRecord(applicationDsl.ui) ? applicationDsl.ui : {};
  const items = isRecord(ui.items) ? ui.items : {};
  const layout = isRecord(ui.layout) ? ui.layout : {};
  const components = listComponentsFromApplicationDsl(applicationDsl);
  const queries = listQueriesFromApplicationDsl(applicationDsl);

  const baselineMeta = ensureBaselineMetaReadonly(applicationDsl);
  const metadataFunctions = Array.isArray(baselineMeta.logic?.functions)
    ? baselineMeta.logic.functions
    : [];
  const datasources = Array.isArray(baselineMeta.integrations?.httpDatasources)
    ? baselineMeta.integrations.httpDatasources
    : [];
  const tempStateCount = listTempStateNames(applicationDsl).length;
  const jsLibraryCount = listPreloadLibraries(applicationDsl).length;
  const jsQueryCount = queries.filter(
    (query) => readStringValue(query.compType, "") === "js",
  ).length;

  return {
    componentCount: Object.keys(items).length,
    layoutNodeCount: Object.keys(layout).length,
    components,
    functionCount: jsQueryCount,
    metadataFunctionCount: metadataFunctions.length,
    queryCount: queries.length,
    tempStateCount,
    jsLibraryCount,
    datasourceCount: datasources.length,
  };
};

export const listComponentsFromApplicationDsl = (
  applicationDsl: JsonRecord,
): Array<Record<string, unknown>> => {
  const { items } = ensureUiReadonly(applicationDsl);
  const components: Array<Record<string, unknown>> = [];
  for (const [nodeId, itemUnknown] of Object.entries(items)) {
    if (!isRecord(itemUnknown)) {
      continue;
    }
    const comp = isRecord(itemUnknown.comp) ? itemUnknown.comp : {};
    const compType = readStringValue(itemUnknown.compType, "unknown");
    components.push({
      nodeId,
      componentId: readStringValue(itemUnknown.name, nodeId),
      componentType: compType,
      text: readDisplayText(comp),
    });
  }
  return components;
};

export const listQueriesFromApplicationDsl = (
  applicationDsl: JsonRecord,
): JsonRecord[] => {
  const rawQueries = Array.isArray(applicationDsl.queries)
    ? applicationDsl.queries
    : [];
  return rawQueries.filter(isRecord);
};

export const inspectApplicationDsl = (
  applicationDsl: JsonRecord,
  options?: {
    componentId?: string;
    includeRawDsl?: boolean;
    maxRawLength?: number;
  },
): Record<string, unknown> => {
  const components = listComponentsFromApplicationDsl(applicationDsl);
  const queries = listQueriesFromApplicationDsl(applicationDsl).map(
    (query) => ({
      id: readStringValue(query.id, ""),
      name: readStringValue(query.name, ""),
      compType: readStringValue(query.compType, ""),
      triggerType: readStringValue(query.triggerType, ""),
    }),
  );
  const tempStates = listTempStateNames(applicationDsl);
  const preload = inspectPreload(applicationDsl);
  const details = listComponentDetails(applicationDsl);
  const filteredDetails = options?.componentId
    ? details.filter(
        (detail) =>
          readStringValue(detail.componentId, "") === options.componentId ||
          readStringValue(detail.nodeId, "") === options.componentId,
      )
    : details;

  const result: Record<string, unknown> = {
    summary: summarizeApplicationDsl(applicationDsl),
    components,
    componentDetails: filteredDetails,
    queries,
    tempStates,
    preload,
  };

  if (options?.includeRawDsl) {
    const maxLength = options.maxRawLength ?? 120_000;
    const raw = JSON.stringify(applicationDsl, null, 2);
    result.rawDsl =
      raw.length > maxLength ? `${raw.slice(0, maxLength)}\n...truncated` : raw;
  }

  return result;
};

const addComponentToApplicationDsl = (
  // @ToDo layout positioning konzept müsste sauberer
  applicationDslInput: JsonRecord,
  operation: Extract<BaselineOperation, { kind: "ui.add_component" }>,
): ApplyOperationResult => {
  const nextDsl = structuredClone(applicationDslInput);
  const { layout, items } = ensureUi(nextDsl);
  ensureGlobalDslDefaults(nextDsl);

  const componentId = ensureUniqueComponentId(
    operation.componentId ??
      `${slugify(operation.componentType)}_${slugify(operation.text ?? "item")}`,
    items,
  );
  const nodeId = ensureUniqueNodeId(
    `node_${sanitizeForNode(componentId)}`,
    layout,
  );
  const index = Object.keys(layout).length;
  const w = operation.w ?? 6;
  const h = operation.h ?? 5;
  const x = operation.x ?? (index % 3) * 8;
  const y = operation.y ?? Math.floor(index / 3) * 6;

  layout[nodeId] = {
    w,
    h,
    x,
    y,
    i: nodeId,
    moved: false,
    static: false,
    isDraggable: true,
    resizeHandles: [],
  };

  const component = createComponentPayload(
    operation.componentType,
    operation.text,
  );
  mergeRecord(component, operation.properties ?? {});
  const events = structuredClone(operation.events);
  applyEventsToComponent(component, events);

  items[nodeId] = {
    compType: normalizeComponentType(operation.componentType),
    comp: component,
    name: componentId,
    __msl_pageId: operation.pageId,
  };

  return {
    nextDsl,
    details: {
      operation: operation.kind,
      componentId,
      nodeId,
      pageId: operation.pageId,
      componentType: normalizeComponentType(operation.componentType),
      position: { x, y, w, h },
    },
  };
};

const updateComponentTextInApplicationDsl = (
  applicationDslInput: JsonRecord,
  operation: Extract<BaselineOperation, { kind: "ui.update_component_text" }>,
): ApplyOperationResult => {
  const nextDsl = structuredClone(applicationDslInput);
  const { items } = ensureUi(nextDsl);
  ensureGlobalDslDefaults(nextDsl);

  const found = getComponentRef(items, operation.componentId);
  if (!found) {
    throw new Error(`Component '${operation.componentId}' not found`);
  }

  const compType = readStringValue(found.item.compType, "unknown");
  const comp = isRecord(found.item.comp) ? found.item.comp : {};
  writeDisplayText(comp, operation.text);
  found.item.comp = comp;
  items[found.nodeId] = found.item;

  return {
    nextDsl,
    details: {
      operation: operation.kind,
      componentId: operation.componentId,
      nodeId: found.nodeId,
      componentType: compType,
      text: operation.text,
    },
  };
};

const updateComponentPropertyInApplicationDsl = (
  applicationDslInput: JsonRecord,
  operation: Extract<
    BaselineOperation,
    { kind: "ui.update_component_property" }
  >,
): ApplyOperationResult => {
  const nextDsl = structuredClone(applicationDslInput);
  const { items } = ensureUi(nextDsl);
  ensureGlobalDslDefaults(nextDsl);

  const found = getComponentRef(items, operation.componentId);
  if (!found) {
    throw new Error(`Component '${operation.componentId}' not found`);
  }
  const comp = isRecord(found.item.comp) ? found.item.comp : {};
  const compType = readStringValue(found.item.compType, "");

  // table.data als Expressionstring sonst Render-Fehler
  if (
    compType === "table" &&
    operation.propertyPath === "data" &&
    Array.isArray(operation.value)
  ) {
    comp.data = `{{${JSON.stringify(operation.value)}}}`;

    const existingColumns = comp.columns;
    const columnsEmpty =
      !Array.isArray(existingColumns) || existingColumns.length === 0;
    if (
      columnsEmpty &&
      operation.value.length > 0 &&
      isRecord(operation.value[0])
    ) {
      comp.columns = Object.keys(
        operation.value[0] as Record<string, unknown>,
      ).map((key) => ({
        title: key.charAt(0).toUpperCase() + key.slice(1),
        dataIndex: key,
      }));
    }
  } else {
    // button.type default wird zu "" (Default was GUI erzeugt)
    let normalizedValue: unknown = operation.value;
    if (
      compType === "button" &&
      operation.propertyPath === "type" &&
      typeof operation.value === "string" &&
      operation.value.toLowerCase() === "default"
    ) {
      normalizedValue = "";
    }
    setByDotPath(comp, operation.propertyPath, normalizedValue);
  }

  found.item.comp = comp;
  items[found.nodeId] = found.item;

  return {
    nextDsl,
    details: {
      operation: operation.kind,
      componentId: operation.componentId,
      nodeId: found.nodeId,
      propertyPath: operation.propertyPath,
      value: operation.value,
    },
  };
};

const moveComponentInApplicationDsl = (
  applicationDslInput: JsonRecord,
  operation: Extract<BaselineOperation, { kind: "ui.move_component" }>,
): ApplyOperationResult => {
  const nextDsl = structuredClone(applicationDslInput);
  const { layout, items } = ensureUi(nextDsl);
  ensureGlobalDslDefaults(nextDsl);

  const found = getComponentRef(items, operation.componentId);
  if (!found) {
    throw new Error(`Component '${operation.componentId}' not found`);
  }
  const existingLayoutCandidate = layout[found.nodeId];
  const existingLayout: JsonRecord = isRecord(existingLayoutCandidate)
    ? existingLayoutCandidate
    : {};
  const x = operation.x ?? readFiniteNumber(existingLayout.x, 0);
  const y = operation.y ?? readFiniteNumber(existingLayout.y, 0);
  const w = operation.w ?? readFiniteNumber(existingLayout.w, 6);
  const h = operation.h ?? readFiniteNumber(existingLayout.h, 5);

  layout[found.nodeId] = {
    ...existingLayout,
    x,
    y,
    w,
    h,
    i: found.nodeId,
  };

  return {
    nextDsl,
    details: {
      operation: operation.kind,
      componentId: operation.componentId,
      nodeId: found.nodeId,
      position: { x, y, w, h },
    },
  };
};

const removeComponentInApplicationDsl = (
  applicationDslInput: JsonRecord,
  operation: Extract<BaselineOperation, { kind: "ui.remove_component" }>,
): ApplyOperationResult => {
  const nextDsl = structuredClone(applicationDslInput);
  const { layout, items } = ensureUi(nextDsl);
  ensureGlobalDslDefaults(nextDsl);

  const found = getComponentRef(items, operation.componentId);
  if (!found) {
    throw new Error(`Component '${operation.componentId}' not found`);
  }

  delete items[found.nodeId];
  delete layout[found.nodeId];

  return {
    nextDsl,
    details: {
      operation: operation.kind,
      componentId: operation.componentId,
      nodeId: found.nodeId,
    },
  };
};

const renameComponentInApplicationDsl = (
  applicationDslInput: JsonRecord,
  operation: Extract<BaselineOperation, { kind: "ui.rename_component" }>,
): ApplyOperationResult => {
  const nextDsl = structuredClone(applicationDslInput);
  const { items } = ensureUi(nextDsl);
  ensureGlobalDslDefaults(nextDsl);

  const found = getComponentRef(items, operation.componentId);
  if (!found) {
    throw new Error(`Component '${operation.componentId}' not found`);
  }

  found.item.name = sanitizeForName(operation.newComponentId);
  items[found.nodeId] = found.item;

  return {
    nextDsl,
    details: {
      operation: operation.kind,
      oldComponentId: operation.componentId,
      newComponentId: found.item.name,
      nodeId: found.nodeId,
    },
  };
};

const upsertBindingInApplicationDsl = (
  applicationDslInput: JsonRecord,
  operation: Extract<BaselineOperation, { kind: "ui.upsert_binding" }>,
): ApplyOperationResult => {
  const nextDsl = structuredClone(applicationDslInput);
  const { items } = ensureUi(nextDsl);
  ensureGlobalDslDefaults(nextDsl);

  const found = getComponentRef(items, operation.componentId);
  if (!found) {
    throw new Error(`Component '${operation.componentId}' not found`);
  }
  const componentType = readStringValue(found.item.compType, "unknown");
  const comp = isRecord(found.item.comp) ? found.item.comp : {};
  const bindings = isRecord(comp.__msl_bindings) ? comp.__msl_bindings : {};
  const resolvedBindingKey = normalizeBindingKey(
    componentType,
    operation.bindingKey,
  );
  const normalizedExpression = normalizeBindingExpression(
    nextDsl,
    operation.expression,
  );
  bindings[resolvedBindingKey] = normalizedExpression;
  comp.__msl_bindings = bindings;

  if (resolvedBindingKey === "__select_map_data") {
    const expressionValue = `{{${normalizedExpression}}}`;
    const options = isRecord(comp.options) ? comp.options : {};
    options.optionType = "map";
    if (!isRecord(options.manual)) {
      options.manual = { manual: [{ value: "1", label: "Option 1" }] };
    }
    const mapData = isRecord(options.mapData) ? options.mapData : {};
    mapData.data = expressionValue;
    mapData.mapData = {
      label: "{{item.label || item.name || item.title || String(item)}}",
      value: "{{item.value || item.url || item.id || String(item)}}",
    };
    options.mapData = mapData;
    comp.options = options;
  } else {
    const expressionValue = `{{${normalizedExpression}}}`;
    setByDotPath(comp, resolvedBindingKey, expressionValue);
  }

  found.item.comp = comp;
  items[found.nodeId] = found.item;
  const bindingWarning = buildBindingWarning(nextDsl, normalizedExpression);

  return {
    nextDsl,
    details: {
      operation: operation.kind,
      componentId: operation.componentId,
      nodeId: found.nodeId,
      componentType,
      bindingKey: resolvedBindingKey,
      originalBindingKey: operation.bindingKey,
      expression: normalizedExpression,
      originalExpression: operation.expression,
      visibility: "native_dsl",
      warning: bindingWarning,
    },
  };
};

const removeBindingInApplicationDsl = (
  applicationDslInput: JsonRecord,
  operation: Extract<BaselineOperation, { kind: "ui.remove_binding" }>,
): ApplyOperationResult => {
  const nextDsl = structuredClone(applicationDslInput);
  const { items } = ensureUi(nextDsl);
  ensureGlobalDslDefaults(nextDsl);

  const found = getComponentRef(items, operation.componentId);
  if (!found) {
    throw new Error(`Component '${operation.componentId}' not found`);
  }
  const componentType = readStringValue(found.item.compType, "unknown");
  const comp = isRecord(found.item.comp) ? found.item.comp : {};
  const bindings = isRecord(comp.__msl_bindings) ? comp.__msl_bindings : {};
  const resolvedBindingKey = normalizeBindingKey(
    componentType,
    operation.bindingKey,
  );
  delete bindings[resolvedBindingKey];
  delete bindings[operation.bindingKey];
  comp.__msl_bindings = bindings;
  removeByDotPath(comp, resolvedBindingKey);
  found.item.comp = comp;
  items[found.nodeId] = found.item;

  return {
    nextDsl,
    details: {
      operation: operation.kind,
      componentId: operation.componentId,
      nodeId: found.nodeId,
      componentType,
      bindingKey: resolvedBindingKey,
      originalBindingKey: operation.bindingKey,
      visibility: "native_dsl",
    },
  };
};

const upsertFunctionInApplicationDsl = (
  applicationDslInput: JsonRecord,
  operation: Extract<BaselineOperation, { kind: "logic.upsert_function" }>,
): ApplyOperationResult => {
  const nextDsl = structuredClone(applicationDslInput);
  ensureGlobalDslDefaults(nextDsl);
  const queries = ensureQueries(nextDsl);
  const baselineMeta = ensureBaselineMeta(nextDsl);
  const functionId = sanitizeForName(
    operation.functionId ?? operation.functionName,
  );
  const normalizedFunctionCode = normalizeFunctionCode(
    operation.functionName,
    operation.code,
  );
  const existingQuery = findQueryByFunctionRef(
    queries,
    functionId,
    operation.functionName,
  );
  const queryId = existingQuery
    ? readStringValue(existingQuery.id, functionId)
    : createQueryId(functionId);

  const nextQuery: JsonRecord = {
    id: queryId,
    name: operation.functionName,
    compType: "js",
    datasourceId: "js",
    triggerType: "manual",
    onEvent: [],
    comp: {
      script: normalizedFunctionCode,
    },
    notification: { showSuccess: false, showFail: false, fail: [{}] },
    timeout: "",
    confirmationModal: {},
    variables: [],
    periodic: false,
    periodicTime: "",
    cancelPrevious: false,
    depQueryName: "",
    delayTime: "",
  };
  if (existingQuery) {
    const existingGid = readStringValue(existingQuery.gid, "");
    if (existingGid) {
      nextQuery.gid = existingGid;
    }
  }

  const existingQueryIndex = queries.findIndex(
    (entry) => entry === existingQuery,
  );
  if (existingQueryIndex >= 0) {
    queries[existingQueryIndex] = nextQuery;
  } else {
    queries.push(nextQuery);
  }
  ensureRefTreeItem(nextDsl, operation.functionName);

  const existingIndex = baselineMeta.logic.functions.findIndex(
    (entry) => readStringValue(entry.id, "") === functionId,
  );
  const nextEntry = {
    id: functionId,
    queryId,
    name: operation.functionName,
    code: normalizedFunctionCode,
    updatedAt: new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    baselineMeta.logic.functions[existingIndex] = nextEntry;
  } else {
    baselineMeta.logic.functions.push(nextEntry);
  }

  return {
    nextDsl,
    details: {
      operation: operation.kind,
      functionId,
      queryId,
      functionName: operation.functionName,
      normalizedCode: normalizedFunctionCode,
      visibility: "native_query",
    },
  };
};

const setComponentActionInApplicationDsl = (
  applicationDslInput: JsonRecord,
  operation: Extract<BaselineOperation, { kind: "logic.set_component_action" }>,
): ApplyOperationResult => {
  const nextDsl = structuredClone(applicationDslInput);
  const { items } = ensureUi(nextDsl);
  ensureGlobalDslDefaults(nextDsl);

  const found = getComponentRef(items, operation.componentId);
  if (!found) {
    throw new Error(`Component '${operation.componentId}' not found`);
  }
  const compType = readStringValue(found.item.compType, "unknown");
  const comp = isRecord(found.item.comp) ? found.item.comp : {};
  const actions = isRecord(comp.__msl_actions) ? comp.__msl_actions : {};
  const normalizedActionName = normalizeComponentActionName(
    operation.actionName ?? "click",
  );
  actions[normalizedActionName] = operation.script;
  comp.__msl_actions = actions;
  upsertComponentEvent(
    comp,
    normalizedActionName,
    operation.script,
    operation.actionType ?? "auto",
    operation.queryName,
  );
  found.item.comp = comp;
  items[found.nodeId] = found.item;
  const queryName =
    operation.actionType === "executeQuery"
      ? (operation.queryName ?? tryExtractQueryNameFromScript(operation.script))
      : tryExtractQueryNameFromScript(operation.script);
  const knownQuery = queryName
    ? findQueryByName(ensureQueriesReadonly(nextDsl), queryName)
    : null;

  return {
    nextDsl,
    details: {
      operation: operation.kind,
      componentId: operation.componentId,
      nodeId: found.nodeId,
      componentType: compType,
      actionName: normalizedActionName,
      originalActionName: operation.actionName,
      visibility: "native_onEvent",
      referencedQuery: queryName ?? null,
      referencedQueryExists: Boolean(knownQuery),
    },
  };
};

const upsertHttpDatasourceInApplicationDsl = (
  applicationDslInput: JsonRecord,
  operation: Extract<
    BaselineOperation,
    { kind: "integration.upsert_http_datasource" }
  >,
): ApplyOperationResult => {
  const nextDsl = structuredClone(applicationDslInput);
  const baselineMeta = ensureBaselineMeta(nextDsl);
  const datasourceId = sanitizeForName(
    operation.datasourceId ?? operation.name,
  );
  const method = (operation.method ?? "GET").toUpperCase();

  const nextEntry = {
    id: datasourceId,
    name: operation.name,
    method,
    url: operation.url,
    headers: structuredClone(operation.headers),
    description: operation.description ?? "",
    updatedAt: new Date().toISOString(),
  };

  const existingIndex = baselineMeta.integrations.httpDatasources.findIndex(
    (entry) => readStringValue(entry.id, "") === datasourceId,
  );
  if (existingIndex >= 0) {
    baselineMeta.integrations.httpDatasources[existingIndex] = nextEntry;
  } else {
    baselineMeta.integrations.httpDatasources.push(nextEntry);
  }

  // @ToDo lowcoder datasource mapping später sauber
  return {
    nextDsl,
    details: {
      operation: operation.kind,
      datasourceId,
      name: operation.name,
      method,
      visibility: "metadata_only",
    },
  };
};

const bindComponentDatasourceInApplicationDsl = (
  applicationDslInput: JsonRecord,
  operation: Extract<
    BaselineOperation,
    { kind: "integration.bind_component_datasource" }
  >,
): ApplyOperationResult => {
  const nextDsl = structuredClone(applicationDslInput);
  const { items } = ensureUi(nextDsl);
  ensureGlobalDslDefaults(nextDsl);

  const found = getComponentRef(items, operation.componentId);
  if (!found) {
    throw new Error(`Component '${operation.componentId}' not found`);
  }
  const comp = isRecord(found.item.comp) ? found.item.comp : {};
  comp.__msl_data_source = {
    datasourceId: operation.datasourceId,
    mode: operation.mode,
    mapping: structuredClone(operation.mapping),
  };
  found.item.comp = comp;
  items[found.nodeId] = found.item;

  // @ToDo lowcoder datasource bindung später saube
  return {
    nextDsl,
    details: {
      operation: operation.kind,
      componentId: operation.componentId,
      nodeId: found.nodeId,
      datasourceId: operation.datasourceId,
      mode: operation.mode,
      visibility: "metadata_only",
    },
  };
};

const upsertTempStateInApplicationDsl = (
  applicationDslInput: JsonRecord,
  operation: Extract<BaselineOperation, { kind: "state.upsert_temp_state" }>,
): ApplyOperationResult => {
  const nextDsl = structuredClone(applicationDslInput);
  if (!Array.isArray(nextDsl.tempStates)) {
    nextDsl.tempStates = [];
  }
  const tempStates = (nextDsl.tempStates as unknown[]).filter(
    isRecord,
  ) as JsonRecord[];
  const stateName = operation.stateName.trim();
  const serializedValue = serializeTempStateValue(operation.value);

  const existingIndex = tempStates.findIndex(
    (entry) => readStringValue(entry.name, "") === stateName,
  );
  const nextState: JsonRecord =
    existingIndex >= 0 ? { ...tempStates[existingIndex] } : {};
  nextState.name = stateName;
  nextState.value = serializedValue;
  if (!("order" in nextState)) {
    nextState.order = Date.now();
  }

  if (existingIndex >= 0) {
    tempStates[existingIndex] = nextState;
  } else {
    tempStates.push(nextState);
  }
  nextDsl.tempStates = tempStates;

  return {
    nextDsl,
    details: {
      operation: operation.kind,
      stateName,
      valuePreview: operation.value,
    },
  };
};

const addJsLibraryToApplicationDsl = (
  applicationDslInput: JsonRecord,
  operation: Extract<BaselineOperation, { kind: "preload.add_js_library" }>,
): ApplyOperationResult => {
  const nextDsl = structuredClone(applicationDslInput);
  ensureGlobalDslDefaults(nextDsl);
  const preload = ensurePreload(nextDsl);
  const libs = (preload.libs as unknown[]).filter(
    (entry) => typeof entry === "string",
  ) as string[];
  const normalizedUrl = normalizeLibraryUrl(operation.url);
  if (!libs.includes(normalizedUrl)) {
    libs.push(normalizedUrl);
  }
  preload.libs = libs;

  return {
    nextDsl,
    details: {
      operation: operation.kind,
      url: normalizedUrl,
      libraryCount: libs.length,
      visibility: "native_preload",
    },
  };
};

const removeJsLibraryFromApplicationDsl = (
  applicationDslInput: JsonRecord,
  operation: Extract<BaselineOperation, { kind: "preload.remove_js_library" }>,
): ApplyOperationResult => {
  const nextDsl = structuredClone(applicationDslInput);
  ensureGlobalDslDefaults(nextDsl);
  const preload = ensurePreload(nextDsl);
  const libs = (preload.libs as unknown[]).filter(
    (entry) => typeof entry === "string",
  ) as string[];
  const normalizedUrl = normalizeLibraryUrl(operation.url);
  const nextLibs = libs.filter((entry) => entry !== normalizedUrl);
  preload.libs = nextLibs;

  return {
    nextDsl,
    details: {
      operation: operation.kind,
      url: normalizedUrl,
      removed: nextLibs.length !== libs.length,
      libraryCount: nextLibs.length,
      visibility: "native_preload",
    },
  };
};

const setPreloadScriptInApplicationDsl = (
  applicationDslInput: JsonRecord,
  operation: Extract<BaselineOperation, { kind: "preload.set_script" }>,
): ApplyOperationResult => {
  const nextDsl = structuredClone(applicationDslInput);
  ensureGlobalDslDefaults(nextDsl);
  const preload = ensurePreload(nextDsl);
  preload.script = operation.script;

  return {
    nextDsl,
    details: {
      operation: operation.kind,
      scriptLength: operation.script.length,
      visibility: "native_preload",
    },
  };
};

const setPreloadCssInApplicationDsl = (
  applicationDslInput: JsonRecord,
  operation: Extract<BaselineOperation, { kind: "preload.set_css" }>,
): ApplyOperationResult => {
  const nextDsl = structuredClone(applicationDslInput);
  ensureGlobalDslDefaults(nextDsl);
  const preload = ensurePreload(nextDsl);
  preload.css = operation.css;

  return {
    nextDsl,
    details: {
      operation: operation.kind,
      cssLength: operation.css.length,
      visibility: "native_preload",
    },
  };
};

const setPreloadGlobalCssInApplicationDsl = (
  applicationDslInput: JsonRecord,
  operation: Extract<BaselineOperation, { kind: "preload.set_global_css" }>,
): ApplyOperationResult => {
  const nextDsl = structuredClone(applicationDslInput);
  ensureGlobalDslDefaults(nextDsl);
  const preload = ensurePreload(nextDsl);
  preload.globalCSS = operation.css;

  return {
    nextDsl,
    details: {
      operation: operation.kind,
      cssLength: operation.css.length,
      visibility: "native_preload",
    },
  };
};

const ensureUi = (
  applicationDsl: JsonRecord,
): { layout: JsonRecord; items: JsonRecord } => {
  if (!isRecord(applicationDsl.ui)) {
    applicationDsl.ui = {};
  }
  const ui = applicationDsl.ui as JsonRecord;
  delete ui.compType;
  delete ui.comp;
  if (!isRecord(ui.layout)) {
    ui.layout = {};
  }
  if (!isRecord(ui.items)) {
    ui.items = {};
  }
  return {
    layout: ui.layout as JsonRecord,
    items: ui.items as JsonRecord,
  };
};

const ensureUiReadonly = (
  applicationDsl: JsonRecord,
): { layout: JsonRecord; items: JsonRecord } => {
  const ui = isRecord(applicationDsl.ui) ? applicationDsl.ui : {};
  return {
    layout: isRecord(ui.layout) ? ui.layout : {},
    items: isRecord(ui.items) ? ui.items : {},
  };
};

const ensureQueries = (applicationDsl: JsonRecord): JsonRecord[] => {
  if (!Array.isArray(applicationDsl.queries)) {
    applicationDsl.queries = [];
  }
  const normalized = (applicationDsl.queries as unknown[]).filter(
    isRecord,
  ) as JsonRecord[];
  applicationDsl.queries = normalized;
  return normalized;
};

const ensureQueriesReadonly = (applicationDsl: JsonRecord): JsonRecord[] => {
  return Array.isArray(applicationDsl.queries)
    ? applicationDsl.queries.filter(isRecord)
    : [];
};

const ensureGlobalDslDefaults = (applicationDsl: JsonRecord): void => {
  if (!Array.isArray(applicationDsl.hooks)) {
    applicationDsl.hooks = createDefaultHooks();
  }
  if (!isRecord(applicationDsl.settings)) {
    applicationDsl.settings = createDefaultSettings();
  }
  if (!isRecord(applicationDsl.preload)) {
    applicationDsl.preload = {
      libs: [],
      script: "",
      css: "",
      globalCSS: "",
    };
  }
  if (!isRecord(applicationDsl.refTree)) {
    applicationDsl.refTree = { value: "" };
  }
};

const ensurePreload = (applicationDsl: JsonRecord): JsonRecord => {
  ensureGlobalDslDefaults(applicationDsl);
  const preload = isRecord(applicationDsl.preload)
    ? applicationDsl.preload
    : {};
  if (!Array.isArray(preload.libs)) {
    preload.libs = [];
  }
  preload.libs = (preload.libs as unknown[])
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
  preload.script = readStringValue(preload.script, "");
  preload.css = readStringValue(preload.css, "");
  preload.globalCSS = readStringValue(preload.globalCSS, "");
  applicationDsl.preload = preload;
  return preload;
};

type BaselineMeta = {
  logic: { functions: JsonRecord[] };
  integrations: { httpDatasources: JsonRecord[] };
};

const ensureBaselineMeta = (applicationDsl: JsonRecord): BaselineMeta => {
  if (!isRecord(applicationDsl.__msl_baseline)) {
    applicationDsl.__msl_baseline = {};
  }
  const root = applicationDsl.__msl_baseline as JsonRecord;
  if (!isRecord(root.logic)) {
    root.logic = {};
  }
  if (!Array.isArray((root.logic as JsonRecord).functions)) {
    (root.logic as JsonRecord).functions = [];
  }
  if (!isRecord(root.integrations)) {
    root.integrations = {};
  }
  if (!Array.isArray((root.integrations as JsonRecord).httpDatasources)) {
    (root.integrations as JsonRecord).httpDatasources = [];
  }
  return {
    logic: { functions: (root.logic as JsonRecord).functions as JsonRecord[] },
    integrations: {
      httpDatasources: (root.integrations as JsonRecord)
        .httpDatasources as JsonRecord[],
    },
  };
};

const ensureBaselineMetaReadonly = (
  applicationDsl: JsonRecord,
): {
  logic?: { functions?: JsonRecord[] };
  integrations?: { httpDatasources?: JsonRecord[] };
} => {
  const root = isRecord(applicationDsl.__msl_baseline)
    ? applicationDsl.__msl_baseline
    : {};
  const logic = isRecord(root.logic) ? root.logic : {};
  const integrations = isRecord(root.integrations) ? root.integrations : {};
  return {
    logic: Array.isArray(logic.functions)
      ? { functions: logic.functions.filter(isRecord) }
      : undefined,
    integrations: Array.isArray(integrations.httpDatasources)
      ? { httpDatasources: integrations.httpDatasources.filter(isRecord) }
      : undefined,
  };
};

const getComponentRef = (
  items: JsonRecord,
  componentId: string,
): ComponentRef | null => {
  const needle = componentId.toLowerCase();
  for (const [nodeId, itemUnknown] of Object.entries(items)) {
    if (!isRecord(itemUnknown)) {
      continue;
    }
    const name = readStringValue(itemUnknown.name, "").toLowerCase();
    if (name === needle || nodeId.toLowerCase() === needle) {
      return { nodeId, item: itemUnknown };
    }
  }
  return null;
};

const listComponentDetails = (
  applicationDsl: JsonRecord,
): Array<Record<string, unknown>> => {
  const { items } = ensureUiReadonly(applicationDsl);
  const details: Array<Record<string, unknown>> = [];
  for (const [nodeId, itemUnknown] of Object.entries(items)) {
    if (!isRecord(itemUnknown)) {
      continue;
    }
    const compType = readStringValue(itemUnknown.compType, "unknown");
    const comp = isRecord(itemUnknown.comp) ? itemUnknown.comp : {};
    const onEvent = Array.isArray(comp.onEvent)
      ? comp.onEvent.filter(isRecord)
      : [];
    const simplifiedEvents = onEvent.map((eventEntry) => {
      const handler = isRecord(eventEntry.handler) ? eventEntry.handler : {};
      return {
        name: readStringValue(eventEntry.name, ""),
        handlerType: readStringValue(handler.compType, ""),
        queryName: isRecord(handler.comp)
          ? readStringValue(handler.comp.queryName, "")
          : "",
        hasScript: isRecord(handler.comp)
          ? typeof handler.comp.script === "string"
          : false,
      };
    });

    details.push({
      nodeId,
      componentId: readStringValue(itemUnknown.name, nodeId),
      componentType: compType,
      text: readDisplayText(comp),
      bindings: isRecord(comp.__msl_bindings)
        ? structuredClone(comp.__msl_bindings)
        : {},
      onEvent: simplifiedEvents,
    });
  }
  return details;
};

const ensureUniqueComponentId = (
  desired: string,
  items: JsonRecord,
): string => {
  const existingNames = new Set(
    Object.values(items)
      .filter(isRecord)
      .map((entry) => readStringValue(entry.name, ""))
      .filter((name) => name.length > 0),
  );
  const sanitizedBase = sanitizeForName(desired);
  if (!existingNames.has(sanitizedBase)) {
    return sanitizedBase;
  }
  let index = 2;
  while (existingNames.has(`${sanitizedBase}_${index}`)) {
    index += 1;
  }
  return `${sanitizedBase}_${index}`;
};

const ensureUniqueNodeId = (desired: string, layout: JsonRecord): string => {
  const sanitizedBase = sanitizeForNode(desired);
  if (!(sanitizedBase in layout)) {
    return sanitizedBase;
  }
  let index = 2;
  while (`${sanitizedBase}_${index}` in layout) {
    index += 1;
  }
  return `${sanitizedBase}_${index}`;
};

const sanitizeForName = (value: string): string => {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? cleaned : "component";
};

const sanitizeForNode = (value: string): string => {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 30);
  return cleaned.length > 0 ? cleaned : "node";
};

const createQueryId = (base: string): string => {
  const suffix = Date.now().toString(36);
  return `q_${sanitizeForName(base)}_${suffix}`;
};

const normalizeLibraryUrl = (urlInput: string): string => {
  const trimmed = urlInput.trim();
  if (!trimmed) {
    throw new Error("Library URL must not be empty");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Library URL is not a valid absolute URL: '${trimmed}'`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Library URL must use http/https: '${trimmed}'`);
  }
  return parsed.toString();
};

const findQueryByFunctionRef = (
  queries: JsonRecord[],
  functionId: string,
  functionName: string,
): JsonRecord | null => {
  const byId = queries.find(
    (entry) => readStringValue(entry.id, "") === functionId,
  );
  if (byId) {
    return byId;
  }
  const byName = findQueryByName(queries, functionName);
  return byName ?? null;
};

const findQueryByName = (
  queries: JsonRecord[],
  functionName: string,
): JsonRecord | null => {
  const lowered = functionName.trim().toLowerCase();
  if (!lowered) {
    return null;
  }
  return (
    queries.find(
      (entry) =>
        readStringValue(entry.name, "").trim().toLowerCase() === lowered,
    ) ?? null
  );
};

const listTempStateNames = (applicationDsl: JsonRecord): string[] => {
  if (!Array.isArray(applicationDsl.tempStates)) {
    return [];
  }
  return applicationDsl.tempStates
    .filter(isRecord)
    .map((entry) => readStringValue(entry.name, "").trim())
    .filter((name) => name.length > 0);
};

const listPreloadLibraries = (applicationDsl: JsonRecord): string[] => {
  const preload = isRecord(applicationDsl.preload)
    ? applicationDsl.preload
    : {};
  const libs = Array.isArray(preload.libs) ? preload.libs : [];
  return libs
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
};

const inspectPreload = (
  applicationDsl: JsonRecord,
): Record<string, unknown> => {
  const preload = isRecord(applicationDsl.preload)
    ? applicationDsl.preload
    : {};
  const script = readStringValue(preload.script, "");
  const css = readStringValue(preload.css, "");
  const globalCSS = readStringValue(preload.globalCSS, "");
  const libs = listPreloadLibraries(applicationDsl);
  return {
    libraryCount: libs.length,
    libraries: libs,
    hasScript: script.trim().length > 0,
    hasCss: css.trim().length > 0,
    hasGlobalCss: globalCSS.trim().length > 0,
    scriptLength: script.length,
    cssLength: css.length,
    globalCssLength: globalCSS.length,
  };
};

const stripMoustache = (expression: string): string => {
  const trimmed = expression.trim();
  if (trimmed.startsWith("{{") && trimmed.endsWith("}}")) {
    return trimmed.slice(2, -2).trim();
  }
  return trimmed;
};

const normalizeBindingExpression = (
  applicationDsl: JsonRecord,
  expression: string,
): string => {
  const raw = stripMoustache(expression);
  const firstSegmentMatch = raw.match(/^([A-Za-z_][A-Za-z0-9_]*)\.(.+)$/);
  if (!firstSegmentMatch) {
    return raw;
  }

  const stateName = firstSegmentMatch[1];
  const tail = firstSegmentMatch[2];
  if (
    tail === "value" ||
    tail.startsWith("value.") ||
    tail.startsWith("setValue") ||
    tail.startsWith("setIn")
  ) {
    return raw;
  }

  const tempStateNames = new Set(listTempStateNames(applicationDsl));
  if (tempStateNames.has(stateName) || stateName === "state") {
    return `${stateName}.value.${tail}`;
  }
  return raw;
};

const buildBindingWarning = (
  applicationDsl: JsonRecord,
  normalizedExpression: string,
): string | undefined => {
  const firstSegmentMatch = normalizedExpression.match(
    /^([A-Za-z_][A-Za-z0-9_]*)\.value(\.|$)/,
  );
  if (!firstSegmentMatch) {
    return undefined;
  }

  const stateName = firstSegmentMatch[1];
  const tempStateNames = new Set(listTempStateNames(applicationDsl));
  if (!tempStateNames.has(stateName)) {
    return `Temp-State '${stateName}' ist nicht vorhanden. Expression bleibt leer, bis der State angelegt ist.`;
  }
  return undefined;
};

const normalizeFunctionCode = (_functionName: string, code: string): string => {
  const trimmed = code.trim();

  if (
    trimmed.includes("return run(args)") &&
    trimmed.includes("function run")
  ) {
    return trimmed;
  }

  // run() ohne return-Aufruf
  if (/^async\s+function\s+run\s*\(/.test(trimmed)) {
    return `${trimmed}\nreturn run(args);`;
  }

  const functionDeclaration = trimmed.match(
    /^(async\s+)?function\s+\w+\s*\([^)]*\)\s*\{([\s\S]+)\}\s*;?\s*$/,
  );
  if (functionDeclaration) {
    const body = functionDeclaration[2].trim();
    return `async function run(args) {\n${body}\n}\nreturn run(args);`;
  }

  const arrowFunction = trimmed.match(
    /^(?:const\s+\w+\s*=\s*)?(async\s*)?\([^)]*\)\s*=>\s*\{([\s\S]+)\}\s*;?\s*$/,
  );
  if (arrowFunction) {
    const body = arrowFunction[2].trim();
    return `async function run(args) {\n${body}\n}\nreturn run(args);`;
  }

  if (
    trimmed.includes(";") ||
    trimmed.includes("await") ||
    trimmed.includes("return") ||
    trimmed.includes("\n")
  ) {
    return `async function run(args) {\n${trimmed}\n}\nreturn run(args);`;
  }

  // einfacher funktionsname als call
  return `${trimmed}();`;
};

const ensureRefTreeItem = (applicationDsl: JsonRecord, name: string): void => {
  if (!isRecord(applicationDsl.refTree)) {
    applicationDsl.refTree = { value: "" };
  }
  const refTree = applicationDsl.refTree as JsonRecord;
  if (!Array.isArray(refTree.items)) {
    refTree.items = [];
  }
  const items = (refTree.items as unknown[]).filter(isRecord) as JsonRecord[];
  const exists = items.some(
    (entry) => readStringValue(entry.value, "") === name,
  );
  if (!exists) {
    items.push({ value: name });
  }
  refTree.items = items;
};

const serializeTempStateValue = (value: unknown): string => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{{") && trimmed.endsWith("}}")) {
      return trimmed.slice(2, -2).trim();
    }
    return JSON.stringify(value);
  }
  if (value === undefined) {
    return "null";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "null";
  }
};

const normalizeBindingKey = (
  componentType: string,
  bindingKey: string,
): string => {
  const normalizedType = componentType.trim().toLowerCase();
  const normalizedKey = bindingKey.trim();
  if (!normalizedKey) {
    throw new Error("bindingKey must not be empty");
  }

  if (normalizedType === "button" && normalizedKey === "title") {
    return "text";
  }

  if (
    normalizedType === "select" &&
    ["items", "options", "data"].includes(normalizedKey)
  ) {
    return "__select_map_data";
  }

  if (
    normalizedType === "radio" &&
    ["items", "options", "data"].includes(normalizedKey)
  ) {
    return "__select_map_data";
  }

  return normalizedKey;
};

const normalizeComponentActionName = (actionName: string): string => {
  const value = actionName.trim();
  if (value === "onClick" || value === "click") {
    return "click";
  }
  if (value === "onDoubleClick" || value === "doubleClick") {
    return "doubleClick";
  }
  return value;
};

const upsertComponentEvent = (
  component: JsonRecord,
  actionName: string,
  script: string,
  actionType: "auto" | "executeQuery" | "runScript" = "auto",
  explicitQueryName?: string,
): void => {
  const onEvent = Array.isArray(component.onEvent)
    ? component.onEvent.filter(isRecord)
    : [];
  const handler = buildActionHandler(script, actionType, explicitQueryName);
  const nextEntry: JsonRecord = {
    name: actionName,
    handler,
  };
  const existingIndex = onEvent.findIndex(
    (entry) => readStringValue(entry.name, "") === actionName,
  );
  if (existingIndex >= 0) {
    onEvent[existingIndex] = nextEntry;
  } else {
    onEvent.push(nextEntry);
  }
  component.onEvent = onEvent;
  if ("onClick" in component) {
    delete component.onClick;
  }
};

const buildActionHandler = (
  script: string,
  actionType: "auto" | "executeQuery" | "runScript" = "auto",
  explicitQueryName?: string,
): JsonRecord => {
  if (actionType === "executeQuery") {
    const queryName =
      explicitQueryName?.trim() ||
      tryExtractQueryNameFromScript(script) ||
      script.trim();
    return {
      compType: "executeQuery",
      comp: { queryName, queryVariables: [] },
      condition: "",
      slowdown: "debounce",
      delay: "",
    };
  }
  if (actionType === "runScript") {
    const extractedQueryName =
      explicitQueryName?.trim() || tryExtractQueryNameFromScript(script);
    if (extractedQueryName) {
      return {
        compType: "executeQuery",
        comp: { queryName: extractedQueryName, queryVariables: [] },
        condition: "",
        slowdown: "debounce",
        delay: "",
      };
    }
    return {
      compType: "runScript",
      comp: { script },
      condition: "",
      slowdown: "debounce",
      delay: "",
    };
  }
  const queryName = tryExtractQueryNameFromScript(script);
  if (queryName) {
    return {
      compType: "executeQuery",
      comp: { queryName, queryVariables: [] },
      condition: "",
      slowdown: "debounce",
      delay: "",
    };
  }
  return {
    compType: "runScript",
    comp: { script },
    condition: "",
    slowdown: "debounce",
    delay: "",
  };
};

const tryExtractQueryNameFromScript = (script: string): string | null => {
  const trimmed = script.trim();
  const patterns = [
    /^([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)\s*;?$/,
    /^([A-Za-z_][A-Za-z0-9_]*)\.run\s*\(\s*\)\s*;?$/,
    /^([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)\s*\.then\s*\(/,
    /^([A-Za-z_][A-Za-z0-9_]*)\.run\s*\(\s*\)\s*\.then\s*\(/,
    /^await\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)/,
    /^await\s+([A-Za-z_][A-Za-z0-9_]*)\.run\s*\(\s*\)/,
  ];
  for (const re of patterns) {
    const match = trimmed.match(re);
    if (match) return match[1];
  }
  return null;
};

const KNOWN_COMPONENT_TYPES = new Set([
  "button",
  "input",
  "text",
  "select",
  "table",
  "container",
  "checkbox",
  "switch",
  "numberInput",
  "textArea",
  "password",
  "date",
  "radio",
  "slider",
  "progress",
  "divider",
  "link",
  "image",
  "form",
  "modal",
  "rating",
]);

const normalizeComponentType = (rawType: string): string => {
  const value = rawType.trim().toLowerCase();
  if (value === "textarea") return "textArea";
  if (value === "number" || value === "number_input") return "numberInput";
  if (value === "toggle") return "switch";
  if (value === "img") return "image";
  if (value === "check") return "checkbox";
  if (KNOWN_COMPONENT_TYPES.has(value)) return value;
  for (const known of KNOWN_COMPONENT_TYPES) {
    if (known.toLowerCase() === value) return known;
  }
  return "text";
};

// Standard-Properties für reaktives Rendering
const COMP_STD: JsonRecord = {
  showDataLoadingIndicators: false,
  preventStyleOverwriting: false,
  appliedThemeId: "",
  version: "latest",
};

const TEXT_STD: JsonRecord = {
  autoHeight: "auto",
  type: "markdown",
  horizontalAlignment: "left",
  contentScrollBar: true,
  verticalAlignment: "center",
  margin: { left: "", right: "", top: "", bottom: "" },
  padding: { left: "", right: "", top: "", bottom: "" },
  ...COMP_STD,
};

const createComponentPayload = (
  componentType: string,
  text?: string,
): JsonRecord => {
  const type = normalizeComponentType(componentType);
  if (type === "button") {
    return {
      buttonType: "default",
      text: text ?? "Button",
      type: "",
      form: "",
      hidden: "false",
      onEvent: [],
      ...COMP_STD,
    };
  }
  if (type === "input") {
    return {
      value: { value: "", defaultValue: "" },
      label: { text: text ?? "", tooltip: "", align: "right" },
      placeholder: "",
      ...COMP_STD,
    };
  }
  if (type === "select") {
    return {
      value: { value: "", defaultValue: "" },
      options: {
        optionType: "manual",
        manual: {
          manual: [
            { value: "1", label: "Option 1" },
            { value: "2", label: "Option 2" },
          ],
        },
        mapData: {
          data: "[]",
          mapData: { label: "{{item}}", value: "{{item}}" },
        },
      },
      label: { text: text ?? "", tooltip: "", align: "right" },
      placeholder: "",
      ...COMP_STD,
    };
  }
  if (type === "table") {
    return {
      columns: [],
      data: [],
      title: text ?? "Table",
      ...COMP_STD,
    };
  }
  if (type === "container") {
    return {
      title: text ?? "Container",
      children: [],
      ...COMP_STD,
    };
  }
  if (type === "checkbox") {
    return {
      value: { value: false, defaultValue: false },
      label: { text: text ?? "Checkbox", tooltip: "", align: "right" },
      onEvent: [],
      ...COMP_STD,
    };
  }
  if (type === "switch") {
    return {
      value: { value: false, defaultValue: false },
      label: { text: text ?? "", tooltip: "", align: "right" },
      onEvent: [],
      ...COMP_STD,
    };
  }
  if (type === "numberInput") {
    return {
      value: { value: "", defaultValue: "" },
      label: { text: text ?? "", tooltip: "", align: "right" },
      placeholder: "",
      min: "",
      max: "",
      step: "1",
      ...COMP_STD,
    };
  }
  if (type === "textArea") {
    return {
      value: { value: "", defaultValue: "" },
      label: { text: text ?? "", tooltip: "", align: "right" },
      placeholder: text ?? "",
      autoHeight: "auto",
      ...COMP_STD,
    };
  }
  if (type === "password") {
    return {
      value: { value: "", defaultValue: "" },
      label: { text: text ?? "Password", tooltip: "", align: "right" },
      placeholder: "",
      ...COMP_STD,
    };
  }
  if (type === "date") {
    return {
      value: { value: "", defaultValue: "" },
      label: { text: text ?? "", tooltip: "", align: "right" },
      placeholder: "",
      format: "YYYY-MM-DD",
      ...COMP_STD,
    };
  }
  if (type === "radio") {
    return {
      value: { value: "", defaultValue: "" },
      options: {
        optionType: "manual",
        manual: {
          manual: [
            { value: "1", label: text ? `${text} 1` : "Option 1" },
            { value: "2", label: text ? `${text} 2` : "Option 2" },
          ],
        },
        mapData: {
          data: "[]",
          mapData: { label: "{{item}}", value: "{{item}}" },
        },
      },
      ...COMP_STD,
    };
  }
  if (type === "slider") {
    return {
      value: { value: "0", defaultValue: "0" },
      max: 100,
      min: 0,
      step: 1,
      label: { text: text ?? "", tooltip: "", align: "right" },
      ...COMP_STD,
    };
  }
  if (type === "progress") {
    return {
      value: "0",
      ...COMP_STD,
    };
  }
  if (type === "divider") {
    return {
      title: text ?? "",
      dashed: false,
      ...COMP_STD,
    };
  }
  // link wird hier als markdown-link erstellt weil LowCoder nicht direkt link kann
  if (type === "link") {
    return {
      text: text
        ? `[${text}](https://example.com)`
        : "[Link](https://example.com)",
      ...TEXT_STD,
    };
  }
  if (type === "image") {
    return {
      src: "",
      alt: text ?? "",
      autoHeight: "auto",
      ...COMP_STD,
    };
  }
  if (type === "form") {
    return {
      title: text ?? "Form",
      children: [],
      ...COMP_STD,
    };
  }
  if (type === "modal") {
    return {
      title: text ?? "Modal",
      children: [],
      visible: false,
      ...COMP_STD,
    };
  }
  if (type === "rating") {
    return {
      value: { value: "0", defaultValue: "0" },
      max: 5,
      label: { text: text ?? "", tooltip: "", align: "right" },
      ...COMP_STD,
    };
  }
  return {
    text: text ?? "Text",
    ...TEXT_STD,
  };
};

const mergeRecord = (target: JsonRecord, input: JsonRecord): void => {
  for (const [key, value] of Object.entries(input)) {
    if (isRecord(value) && isRecord(target[key])) {
      mergeRecord(target[key] as JsonRecord, value);
      continue;
    }
    target[key] = structuredClone(value);
  }
};

const applyEventsToComponent = (
  component: JsonRecord,
  events: JsonRecord,
): void => {
  if (!events || Object.keys(events).length === 0) {
    return;
  }
  const existing = isRecord(component.__msl_events)
    ? component.__msl_events
    : {};
  mergeRecord(existing, events);
  component.__msl_events = existing;
  for (const [eventName, script] of Object.entries(events)) {
    if (typeof script !== "string" || script.trim().length === 0) {
      continue;
    }
    upsertComponentEvent(
      component,
      normalizeComponentActionName(eventName),
      script,
    );
  }
};

const setByDotPath = (root: JsonRecord, path: string, value: unknown): void => {
  const segments = path
    .split(".")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    throw new Error(`Invalid propertyPath '${path}'`);
  }
  let cursor: JsonRecord = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index];
    const current = cursor[key];
    if (!isRecord(current)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as JsonRecord;
  }
  cursor[segments[segments.length - 1]] = structuredClone(value);
};

const removeByDotPath = (root: JsonRecord, path: string): void => {
  const segments = path
    .split(".")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return;
  }

  let cursor: JsonRecord = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index];
    const current = cursor[key];
    if (!isRecord(current)) {
      return;
    }
    cursor = current;
  }
  delete cursor[segments[segments.length - 1]];
};

const readDisplayText = (component: JsonRecord): string | undefined => {
  if (typeof component.text === "string" && component.text.length > 0) {
    return component.text;
  }
  if (isRecord(component.label) && typeof component.label.text === "string") {
    return component.label.text;
  }
  return undefined;
};

const writeDisplayText = (component: JsonRecord, text: string): void => {
  if (typeof component.text === "string") {
    component.text = text;
    return;
  }
  if (isRecord(component.label)) {
    component.label.text = text;
    return;
  }
  component.text = text;
};

const createDefaultHooks = (): JsonRecord[] => {
  return [
    { compType: "urlParams", comp: {}, name: "url" },
    { compType: "dayJsLib", comp: {}, name: "dayjs" },
    { compType: "lodashJsLib", comp: {}, name: "_" },
    { compType: "utils", comp: {}, name: "utils" },
    { compType: "message", comp: {}, name: "message" },
    { compType: "toast", comp: {}, name: "toast" },
    { compType: "localStorage", comp: {}, name: "localStorage" },
    { compType: "currentUser", comp: {}, name: "currentUser" },
    { compType: "screenInfo", comp: {}, name: "screenInfo" },
    { compType: "theme", comp: {}, name: "theme" },
  ];
};

const createDefaultSettings = (): JsonRecord => {
  return {
    title: "",
    description: "",
    category: "Business",
    showHeaderInPublic: true,
    themeId: "default",
    preventAppStylesOverwriting: true,
    disableCollision: false,
    lowcoderCompVersion: "latest",
    maxWidth: {
      dropdown: "1920",
      input: 0,
    },
  };
};
