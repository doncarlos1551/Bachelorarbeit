import fastJsonPatch, { type Operation } from "fast-json-patch";
import { isRecord, type JsonRecord } from "src/shared/utils";

const { compare } = fastJsonPatch;

// === Types ===

export type PatchCategory = "semantic" | "structural" | "metadata";

export interface ClassifiedPatch {
  op: string;
  path: string;
  value?: unknown;
  oldValue?: unknown;
  category: PatchCategory;
  humanLabel?: string;
}

export interface DiffEntry {
  headline: string;
  kind:
    | "component"
    | "property"
    | "event"
    | "query"
    | "rename"
    | "tempState"
    | "preload"
    | "generic";
  subjectName?: string;
  propertyName?: string;
  oldValue?: string;
  newValue?: string;
  multiline?: boolean;
  path: string;
  category: PatchCategory;
}

export interface StructuralDiffResult {
  allPatches: Operation[];
  classified: ClassifiedPatch[];
  relevantPatches: ClassifiedPatch[];
  humanSummary: string[];
  humanEntries: DiffEntry[];
  counts: {
    semantic: number;
    structural: number;
    metadata: number;
    total: number;
  };
}

// === Metadata-Filter ===
// filtert Lowcoder interne Felder aus dem diff (Maoz et al. 2011, semantic diffing)

const METADATA_PATH_SEGMENTS: string[] = [
  // Component-Housekeeping
  "/version",
  "/showDataLoadingIndicators",
  "/preventStyleOverwriting",
  "/appliedThemeId",
  // Layout
  "/moved",
  "/static",
  "/isDraggable",
  "/resizeHandles",
  // MSL internes Tracking
  "/__msl_",
  // Query-Housekeeping
  "/notification",
  "/timeout",
  "/confirmationModal",
  "/periodic",
  "/periodicTime",
  "/cancelPrevious",
  "/depQueryName",
  "/delayTime",
  "/gid",
  "/variables",
  "/datasourceId",
  "/triggerType",
  // TempState
  "/order",
  "/refTree",
];

const METADATA_TOP_LEVEL_PATHS: string[] = ["/__msl_baseline", "/refTree"];

const isMetadataPath = (path: string): boolean => {
  for (const top of METADATA_TOP_LEVEL_PATHS) {
    if (path.startsWith(top)) return true;
  }
  if (path.includes("/__msl_")) return true;
  for (const segment of METADATA_PATH_SEGMENTS) {
    if (path.endsWith(segment) || path.includes(segment + "/")) return true;
  }
  return false;
};

// === Layout-Positionen ===

const STRUCTURAL_PATH_PATTERNS: RegExp[] = [
  /\/layout\/[^/]+\/(x|y|w|h)$/,
  /\/comp\/(margin|padding)\//,
  /\/comp\/(autoHeight|horizontalAlignment|verticalAlignment)/,
];

const isStructuralPath = (path: string): boolean => {
  return STRUCTURAL_PATH_PATTERNS.some((pattern) => pattern.test(path));
};

// === Array-Normalisierung ===
// queries und tempStates per name als Key sonst machen die Index-Noise (Ao Sun 2023, unordered array comparison)

const normalizeArraysForDiff = (dsl: JsonRecord): JsonRecord => {
  const normalized = structuredClone(dsl);

  if (Array.isArray(normalized.queries)) {
    const keyed: Record<string, unknown> = {};
    for (const q of normalized.queries) {
      if (isRecord(q) && typeof q.name === "string" && q.name.length > 0) {
        keyed[q.name] = q;
      }
    }
    normalized.queries = keyed;
  }

  if (Array.isArray(normalized.tempStates)) {
    const keyed: Record<string, unknown> = {};
    for (const ts of normalized.tempStates) {
      if (isRecord(ts) && typeof ts.name === "string" && ts.name.length > 0) {
        keyed[ts.name] = ts;
      }
    }
    normalized.tempStates = keyed;
  }

  return normalized;
};

// === Patch-Klassifikation ===

const classifyPatch = (
  patch: Operation,
  baseline: JsonRecord,
): ClassifiedPatch => {
  const category: PatchCategory = isMetadataPath(patch.path)
    ? "metadata"
    : isStructuralPath(patch.path)
      ? "structural"
      : "semantic";

  let oldValue: unknown;
  if (patch.op === "replace" || patch.op === "remove") {
    oldValue = resolvePathValue(baseline, patch.path);
  }

  return {
    op: patch.op,
    path: patch.path,
    value: "value" in patch ? patch.value : undefined,
    oldValue,
    category,
    humanLabel: humanizePatch(patch, oldValue, baseline),
  };
};

// === user-lesbare Patch-Labels ===
// @ToDo deutlich mehr bauen

const resolveComponentName = (
  baseline: JsonRecord,
  nodeId: string | undefined,
): string => {
  if (!nodeId) return "?";
  const items = resolvePathValue(baseline, `/ui/items/${nodeId}`);
  if (
    isRecord(items) &&
    typeof items.name === "string" &&
    items.name.length > 0
  ) {
    return items.name;
  }
  return nodeId.replace(/^node_/, "");
};

const formatValue = (v: unknown): string => {
  if (v === undefined || v === null) return "∅";
  if (typeof v === "string") return `'${truncate(v, 40)}'`;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.length} Eintrag/Einträge]`;
  if (typeof v === "object") {
    try {
      return truncate(JSON.stringify(v), 50);
    } catch {
      return "{...}";
    }
  }
  return truncate(String(v), 40);
};

const describeHandler = (handler: unknown): string => {
  if (!isRecord(handler)) return "geändert";
  const compType = typeof handler.compType === "string" ? handler.compType : "";
  if (compType === "executeQuery") {
    const comp = isRecord(handler.comp) ? handler.comp : {};
    const qn = typeof comp.queryName === "string" ? comp.queryName : "?";
    return `-> Query '${qn}' ausführen`;
  }
  if (compType === "runScript") {
    const comp = isRecord(handler.comp) ? handler.comp : {};
    const script =
      typeof comp.script === "string" ? truncate(comp.script, 40) : "?";
    return `-> JS: ${script}`;
  }
  return "geändert";
};

const humanizePatch = (
  patch: Operation,
  oldValue: unknown,
  baseline: JsonRecord,
): string => {
  const path = patch.path;
  const value = "value" in patch ? patch.value : undefined;

  const componentMatch = path.match(/^\/ui\/items\/([^/]+)$/);
  if (componentMatch) {
    const nodeId = componentMatch[1];
    if (patch.op === "add" && isRecord(value)) {
      const name = String(value.name ?? nodeId ?? "?");
      const type = String(value.compType ?? "unknown");
      const text =
        typeof value.comp === "object" &&
        value.comp !== null &&
        "text" in value.comp
          ? truncate(
              String((value.comp as Record<string, unknown>).text ?? ""),
              30,
            )
          : "";
      return text
        ? `Komponente '${name}' hinzugefügt (${type}, Text: '${text}')`
        : `Komponente '${name}' hinzugefügt (${type})`;
    }
    if (patch.op === "remove") {
      const name = resolveComponentName(baseline, nodeId);
      return `Komponente '${name}' entfernt`;
    }
  }

  const compPropMatch = path.match(/^\/ui\/items\/([^/]+)\/comp\/(.+)$/);
  if (compPropMatch) {
    const nodeId = compPropMatch[1];
    const propPath = compPropMatch[2] ?? "";
    const name = resolveComponentName(baseline, nodeId);

    if (propPath === "text" && patch.op === "replace") {
      return `'${name}': Text '${truncate(String(oldValue ?? ""), 30)}' -> '${truncate(String(value ?? ""), 30)}'`;
    }
    if (propPath.startsWith("onEvent")) {
      return `'${name}': Event-Handler ${describeHandler(value)}`;
    }
    if (propPath === "hidden") {
      return `'${name}': Sichtbarkeit ${oldValue ? "sichtbar" : "versteckt"} -> ${value ? "versteckt" : "sichtbar"}`;
    }
    if (patch.op === "replace") {
      const oldStr = formatValue(oldValue);
      const newStr = formatValue(value);
      return `'${name}': Property '${propPath}' ${oldStr} -> ${newStr}`;
    }
    if (patch.op === "add") {
      return `'${name}': Property '${propPath}' gesetzt auf ${formatValue(value)}`;
    }
    if (patch.op === "remove") {
      return `'${name}': Property '${propPath}' entfernt`;
    }
    return `'${name}': Property '${propPath}' geändert`;
  }

  const nameMatch = path.match(/^\/ui\/items\/([^/]+)\/name$/);
  if (nameMatch && patch.op === "replace") {
    return `Komponente umbenannt: '${String(oldValue)}' -> '${String(value)}'`;
  }

  const queryScriptMatch = path.match(/^\/queries\/([^/]+)\/comp\/script$/);
  if (queryScriptMatch) {
    const queryName = queryScriptMatch[1];
    return `Query '${queryName}': Code geändert`;
  }

  const queryMatch = path.match(/^\/queries\/([^/]+)$/);
  if (queryMatch) {
    if (patch.op === "add") {
      return `Query '${queryMatch[1]}' hinzugefügt`;
    }
    if (patch.op === "remove") {
      return `Query '${queryMatch[1]}' entfernt`;
    }
  }

  const tempStateMatch = path.match(/^\/tempStates\/([^/]+)$/);
  if (tempStateMatch) {
    if (patch.op === "add")
      return `TempState '${tempStateMatch[1]}' hinzugefügt`;
    if (patch.op === "remove")
      return `TempState '${tempStateMatch[1]}' entfernt`;
  }
  const tempStateValueMatch = path.match(/^\/tempStates\/([^/]+)\/value$/);
  if (tempStateValueMatch) {
    return `TempState '${tempStateValueMatch[1]}': Wert geändert`;
  }

  if (path === "/preload/script" || path.startsWith("/preload/script")) {
    return "Preload-Script geändert";
  }
  if (path === "/preload/css" || path.startsWith("/preload/css")) {
    return "Preload-CSS geändert";
  }
  if (path === "/preload/globalCSS" || path.startsWith("/preload/globalCSS")) {
    return "Global-CSS geändert";
  }
  if (path.startsWith("/preload/libs")) {
    return patch.op === "add"
      ? "JS-Bibliothek hinzugefügt"
      : "JS-Bibliothek entfernt";
  }

  const layoutMatch = path.match(/^\/ui\/layout\/([^/]+)$/);
  if (layoutMatch) {
    const nodeId = layoutMatch[1] ?? "";
    const compName = resolveComponentName(baseline, nodeId);
    if (patch.op === "add") return `Layout für '${compName}' hinzugefügt`;
    if (patch.op === "remove") return `Layout für '${compName}' entfernt`;
  }

  return `${patch.op}: ${path}`;
};

// === Public API ===

export const computeStructuralDiff = (
  baselineDsl: JsonRecord,
  candidateDsl: JsonRecord,
): StructuralDiffResult => {
  const normalizedBaseline = normalizeArraysForDiff(baselineDsl);
  const normalizedCandidate = normalizeArraysForDiff(candidateDsl);

  const allPatches = compare(normalizedBaseline, normalizedCandidate);
  const classified = allPatches.map((patch) =>
    classifyPatch(patch, normalizedBaseline),
  );

  const relevantPatches = classified.filter((p) => p.category !== "metadata");
  const humanSummary = relevantPatches
    .map((patch) => patch.humanLabel)
    .filter((label): label is string => typeof label === "string");

  const uniqueSummary = [...new Set(humanSummary)];

  const humanEntries = relevantPatches.map((p) =>
    buildDiffEntry(p, normalizedBaseline),
  );

  return {
    allPatches,
    classified,
    relevantPatches,
    humanSummary: uniqueSummary,
    humanEntries,
    counts: {
      semantic: classified.filter((p) => p.category === "semantic").length,
      structural: classified.filter((p) => p.category === "structural").length,
      metadata: classified.filter((p) => p.category === "metadata").length,
      total: allPatches.length,
    },
  };
};

const serializeForDiff = (v: unknown): string => {
  if (v === undefined || v === null) return "∅";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
};

const isMultiline = (...vals: string[]): boolean =>
  vals.some((v) => v.includes("\n") || v.length > 60);

const buildDiffEntry = (
  patch: ClassifiedPatch,
  baseline: JsonRecord,
): DiffEntry => {
  const path = patch.path;

  const componentMatch = path.match(/^\/ui\/items\/([^/]+)$/);
  if (componentMatch) {
    const nodeId = componentMatch[1] ?? "?";
    if (patch.op === "add" && isRecord(patch.value)) {
      const name = String(patch.value.name ?? nodeId);
      const compType = String(patch.value.compType ?? "unknown");
      return {
        headline: `Komponente '${name}' hinzugefügt (${compType})`,
        kind: "component",
        subjectName: name,
        newValue: serializeForDiff(patch.value),
        multiline: true,
        path,
        category: patch.category,
      };
    }
    if (patch.op === "remove") {
      const name = resolveComponentName(baseline, nodeId);
      return {
        headline: `Komponente '${name}' entfernt`,
        kind: "component",
        subjectName: name,
        oldValue: serializeForDiff(patch.oldValue),
        multiline: true,
        path,
        category: patch.category,
      };
    }
  }

  const compPropMatch = path.match(/^\/ui\/items\/([^/]+)\/comp\/(.+)$/);
  if (compPropMatch) {
    const nodeId = compPropMatch[1];
    const propPath = compPropMatch[2] ?? "";
    const name = resolveComponentName(baseline, nodeId);
    const oldSerialized = serializeForDiff(patch.oldValue);
    const newSerialized = serializeForDiff(patch.value);
    const kind: DiffEntry["kind"] = propPath.startsWith("onEvent")
      ? "event"
      : "property";
    const headline =
      kind === "event"
        ? `'${name}': Event-Handler geändert`
        : `'${name}': Property '${propPath}' geändert`;
    return {
      headline,
      kind,
      subjectName: name,
      propertyName: propPath,
      oldValue: patch.op === "add" ? undefined : oldSerialized,
      newValue: patch.op === "remove" ? undefined : newSerialized,
      multiline: isMultiline(oldSerialized, newSerialized),
      path,
      category: patch.category,
    };
  }

  const nameMatch = path.match(/^\/ui\/items\/([^/]+)\/name$/);
  if (nameMatch && patch.op === "replace") {
    return {
      headline: `Komponente umbenannt: '${String(patch.oldValue)}' -> '${String(patch.value)}'`,
      kind: "rename",
      oldValue: String(patch.oldValue ?? ""),
      newValue: String(patch.value ?? ""),
      multiline: false,
      path,
      category: patch.category,
    };
  }

  const queryScriptMatch = path.match(/^\/queries\/([^/]+)\/comp\/script$/);
  if (queryScriptMatch) {
    const queryName = queryScriptMatch[1] ?? "?";
    return {
      headline: `Query '${queryName}': Code geändert`,
      kind: "query",
      subjectName: queryName,
      propertyName: "script",
      oldValue: serializeForDiff(patch.oldValue),
      newValue: serializeForDiff(patch.value),
      multiline: true,
      path,
      category: patch.category,
    };
  }

  const queryMatch = path.match(/^\/queries\/([^/]+)$/);
  if (queryMatch) {
    const queryName = queryMatch[1] ?? "?";
    if (patch.op === "add") {
      return {
        headline: `Query '${queryName}' hinzugefügt`,
        kind: "query",
        subjectName: queryName,
        newValue: serializeForDiff(patch.value),
        multiline: true,
        path,
        category: patch.category,
      };
    }
    if (patch.op === "remove") {
      return {
        headline: `Query '${queryName}' entfernt`,
        kind: "query",
        subjectName: queryName,
        oldValue: serializeForDiff(patch.oldValue),
        multiline: true,
        path,
        category: patch.category,
      };
    }
  }

  const tempStateMatch = path.match(/^\/tempStates\/([^/]+)(\/value)?$/);
  if (tempStateMatch) {
    const stateName = tempStateMatch[1] ?? "?";
    return {
      headline: patch.humanLabel ?? `TempState '${stateName}' geändert`,
      kind: "tempState",
      subjectName: stateName,
      oldValue:
        patch.op === "add" ? undefined : serializeForDiff(patch.oldValue),
      newValue:
        patch.op === "remove" ? undefined : serializeForDiff(patch.value),
      multiline: true,
      path,
      category: patch.category,
    };
  }

  if (path.startsWith("/preload/")) {
    return {
      headline: patch.humanLabel ?? "Preload geändert",
      kind: "preload",
      oldValue:
        patch.op === "add" ? undefined : serializeForDiff(patch.oldValue),
      newValue:
        patch.op === "remove" ? undefined : serializeForDiff(patch.value),
      multiline: true,
      path,
      category: patch.category,
    };
  }

  const oldSerialized = serializeForDiff(patch.oldValue);
  const newSerialized = serializeForDiff(patch.value);
  return {
    headline: patch.humanLabel ?? `${patch.op}: ${path}`,
    kind: "generic",
    oldValue: patch.op === "add" ? undefined : oldSerialized,
    newValue: patch.op === "remove" ? undefined : newSerialized,
    multiline: isMultiline(oldSerialized, newSerialized),
    path,
    category: patch.category,
  };
};

// === Helpers ===

const resolvePathValue = (obj: JsonRecord, path: string): unknown => {
  const segments = path.split("/").filter((s) => s.length > 0);
  let current: unknown = obj;
  for (const segment of segments) {
    if (!isRecord(current as Record<string, unknown>)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

const truncate = (str: string, maxLen: number): string => {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
};
