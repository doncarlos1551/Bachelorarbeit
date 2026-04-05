import { isRecord, type JsonRecord } from "src/shared/utils";

// === Types ===

export type NodeType = "component" | "query" | "tempState" | "preload";

export interface DependencyNode {
  id: string;
  type: NodeType;
  name: string;
}

export type EdgeType = "binding" | "event" | "action" | "code_ref";

export interface DependencyEdge {
  from: string;
  to: string;
  type: EdgeType;
  context: string;
}

export interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  edges: DependencyEdge[];
  reverseIndex: Map<string, DependencyEdge[]>;
}

export interface BlastRadiusResult {
  directDependents: number;
  dependentDetails: Array<{
    nodeId: string;
    nodeName: string;
    edgeType: EdgeType;
    context: string;
  }>;
  hasTransitiveDependents: boolean;
  totalAffected: number;
}

// === Regexes für Referenzextraktion ===
// Pattern-basiert nach Brito et al. 2023 mit Word-Boundary-Guards gegen false positives

// {{root.property}}
const BINDING_ROOT_REGEX = /\{\{\s*([A-Za-z_]\w*)\s*\./g;

// name.run(), name.trigger(), etc
const CODE_CALL_REGEX =
  /\b([A-Za-z_]\w*)\s*\.\s*(run|trigger|setValue|setIn|reset|clearValue)\s*\(/g;

const SIMPLE_CALL_REGEX = /^\s*([A-Za-z_]\w*)\s*\(/;

// globale Roots - keine Component-Referenzen
const GLOBAL_ROOTS = new Set([
  "state",
  "query",
  "queries",
  "data",
  "appsmith",
  "moment",
  "utils",
  "currentUser",
  "context",
  "params",
  "Math",
  "JSON",
  "Date",
  "Number",
  "String",
  "Array",
  "Object",
  "Boolean",
  "console",
  "parseInt",
  "parseFloat",
  "undefined",
  "null",
  "true",
  "false",
  "NaN",
  "Infinity",
  "window",
  "document",
  "setTimeout",
  "setInterval",
  "clearTimeout",
  "clearInterval",
  "Promise",
  "fetch",
  "encodeURIComponent",
  "decodeURIComponent",
  "item",
  "i",
  "index",
  "row",
  "record",
  "el",
]);

// === Graph-Aufbau ===

export const buildDependencyGraph = (
  applicationDsl: JsonRecord,
): DependencyGraph => {
  const nodes = new Map<string, DependencyNode>();
  const edges: DependencyEdge[] = [];

  const knownNames = new Set<string>();

  const uiObj = isRecord(applicationDsl.ui) ? applicationDsl.ui : {};
  const items = isRecord(uiObj.items) ? uiObj.items : {};

  for (const [nodeId, itemRaw] of Object.entries(items)) {
    if (!isRecord(itemRaw)) continue;
    const name = typeof itemRaw.name === "string" ? itemRaw.name : nodeId;
    const id = `component:${name}`;
    nodes.set(id, { id, type: "component", name });
    knownNames.add(name);
  }

  const queries = Array.isArray(applicationDsl.queries)
    ? applicationDsl.queries
    : [];
  for (const qRaw of queries) {
    if (!isRecord(qRaw) || typeof qRaw.name !== "string") continue;
    const id = `query:${qRaw.name}`;
    nodes.set(id, { id, type: "query", name: qRaw.name });
    knownNames.add(qRaw.name);
  }

  const tempStates = Array.isArray(applicationDsl.tempStates)
    ? applicationDsl.tempStates
    : [];
  for (const tsRaw of tempStates) {
    if (!isRecord(tsRaw) || typeof tsRaw.name !== "string") continue;
    const id = `tempState:${tsRaw.name}`;
    nodes.set(id, { id, type: "tempState", name: tsRaw.name });
    knownNames.add(tsRaw.name);
  }

  const resolveRef = (name: string): string | undefined => {
    if (!knownNames.has(name) || GLOBAL_ROOTS.has(name)) return undefined;
    if (nodes.has(`component:${name}`)) return `component:${name}`;
    if (nodes.has(`query:${name}`)) return `query:${name}`;
    if (nodes.has(`tempState:${name}`)) return `tempState:${name}`;
    return undefined;
  };

  for (const [_nodeId, itemRaw] of Object.entries(items)) {
    if (!isRecord(itemRaw)) continue;
    const compName = typeof itemRaw.name === "string" ? itemRaw.name : _nodeId;
    const fromId = `component:${compName}`;
    const comp = isRecord(itemRaw.comp) ? itemRaw.comp : {};

    walkStrings(comp, (path, value) => {
      const refs = extractBindingRoots(value);
      for (const ref of refs) {
        const targetId = resolveRef(ref);
        if (targetId && targetId !== fromId) {
          edges.push({
            from: fromId,
            to: targetId,
            type: "binding",
            context: `${compName}.${path}: ${truncateCtx(value)}`,
          });
        }
      }
    });

    if (Array.isArray(comp.onEvent)) {
      for (const event of comp.onEvent) {
        if (!isRecord(event)) continue;
        const handler = isRecord(event.handler) ? event.handler : {};
        const handlerComp = isRecord(handler.comp) ? handler.comp : {};

        if (
          typeof handlerComp.queryName === "string" &&
          handlerComp.queryName.length > 0
        ) {
          const targetId = resolveRef(handlerComp.queryName);
          if (targetId) {
            const eventName =
              typeof event.name === "string" ? event.name : "event";
            edges.push({
              from: fromId,
              to: targetId,
              type: "event",
              context: `${compName}.onEvent.${eventName} -> ${handlerComp.queryName}`,
            });
          }
        }

        if (
          typeof handlerComp.script === "string" &&
          handlerComp.script.length > 0
        ) {
          const codeRefs = extractCodeReferences(handlerComp.script);
          for (const ref of codeRefs) {
            const targetId = resolveRef(ref);
            if (targetId && targetId !== fromId) {
              const eventName =
                typeof event.name === "string" ? event.name : "event";
              edges.push({
                from: fromId,
                to: targetId,
                type: "action",
                context: `${compName}.onEvent.${eventName}: ${ref}.run()`,
              });
            }
          }
        }
      }
    }
  }

  for (const qRaw of queries) {
    if (!isRecord(qRaw) || typeof qRaw.name !== "string") continue;
    const fromId = `query:${qRaw.name}`;
    const comp = isRecord(qRaw.comp) ? qRaw.comp : {};

    if (typeof comp.script === "string" && comp.script.length > 0) {
      const bindingRefs = extractBindingRoots(comp.script);
      for (const ref of bindingRefs) {
        const targetId = resolveRef(ref);
        if (targetId && targetId !== fromId) {
          edges.push({
            from: fromId,
            to: targetId,
            type: "code_ref",
            context: `${qRaw.name}: referenziert ${ref}`,
          });
        }
      }

      const codeRefs = extractCodeReferences(comp.script);
      for (const ref of codeRefs) {
        const targetId = resolveRef(ref);
        if (targetId && targetId !== fromId) {
          edges.push({
            from: fromId,
            to: targetId,
            type: "code_ref",
            context: `${qRaw.name}: ruft ${ref}.run() auf`,
          });
        }
      }
    }
  }

  const reverseIndex = new Map<string, DependencyEdge[]>();
  for (const edge of edges) {
    const existing = reverseIndex.get(edge.to) ?? [];
    existing.push(edge);
    reverseIndex.set(edge.to, existing);
  }

  return { nodes, edges, reverseIndex };
};

// === Blast-Radius ===
// Auswirkungen einer Löschung oder Umbenennung (Bohner und Arnold 1996, source dependency analysis)
// Scope: Level 1 direkt und Level 2 als Warnung

export const analyzeBlastRadius = (
  graph: DependencyGraph,
  targetName: string,
): BlastRadiusResult => {
  const targetIds = [
    `component:${targetName}`,
    `query:${targetName}`,
    `tempState:${targetName}`,
  ].filter((id) => graph.nodes.has(id));

  if (targetIds.length === 0) {
    return {
      directDependents: 0,
      dependentDetails: [],
      hasTransitiveDependents: false,
      totalAffected: 0,
    };
  }

  // Level 1: direkter Abhängige
  const directEdges: DependencyEdge[] = [];
  const directNodeIds = new Set<string>();

  for (const targetId of targetIds) {
    const edges = graph.reverseIndex.get(targetId) ?? [];
    for (const edge of edges) {
      directEdges.push(edge);
      directNodeIds.add(edge.from);
    }
  }

  const dependentDetails = directEdges.map((edge) => {
    const node = graph.nodes.get(edge.from);
    return {
      nodeId: edge.from,
      nodeName: node?.name ?? edge.from,
      edgeType: edge.type,
      context: edge.context,
    };
  });

  // Level 2 mit Cycle-Safety
  let hasTransitiveDependents = false;
  const visited = new Set<string>(targetIds);

  for (const nodeId of directNodeIds) {
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    const transEdges = graph.reverseIndex.get(nodeId) ?? [];
    if (transEdges.length > 0) {
      hasTransitiveDependents = true;
      break;
    }
  }

  return {
    directDependents: directNodeIds.size,
    dependentDetails,
    hasTransitiveDependents,
    totalAffected: directNodeIds.size,
  };
};

// === Referenz-Extraktion ===

// {{root}}-Extraktion @ToDo noch zu fragil
const extractBindingRoots = (value: string): string[] => {
  const roots = new Set<string>();
  BINDING_ROOT_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BINDING_ROOT_REGEX.exec(value)) !== null) {
    const root = match[1];
    if (!GLOBAL_ROOTS.has(root)) {
      roots.add(root);
    }
  }
  return [...roots];
};

const extractCodeReferences = (code: string): string[] => {
  const refs = new Set<string>();

  CODE_CALL_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CODE_CALL_REGEX.exec(code)) !== null) {
    const name = match[1];
    if (!GLOBAL_ROOTS.has(name)) {
      refs.add(name);
    }
  }

  // Property zugriff wie searchInput.value
  const PROPERTY_ACCESS_REGEX =
    /\b([A-Za-z_]\w*)\s*\.\s*(value|data|selectedRow|selectedRows|displayedData|sortedData|pageNo|pageSize|visible|text|checked|files)\b/g;
  PROPERTY_ACCESS_REGEX.lastIndex = 0;
  while ((match = PROPERTY_ACCESS_REGEX.exec(code)) !== null) {
    const name = match[1];
    if (!GLOBAL_ROOTS.has(name)) {
      refs.add(name);
    }
  }

  const simpleMatch = code.match(SIMPLE_CALL_REGEX);
  if (simpleMatch && !GLOBAL_ROOTS.has(simpleMatch[1])) {
    refs.add(simpleMatch[1]);
  }

  return [...refs];
};

const walkStrings = (
  obj: Record<string, unknown>,
  callback: (path: string, value: string) => void,
  prefix = "",
): void => {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string" && value.length > 3) {
      callback(path, value);
    } else if (isRecord(value)) {
      walkStrings(value, callback, path);
    } else if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        if (typeof value[i] === "string" && value[i].length > 3) {
          callback(`${path}[${i}]`, value[i]);
        } else if (isRecord(value[i])) {
          walkStrings(value[i], callback, `${path}[${i}]`);
        }
      }
    }
  }
};

const truncateCtx = (str: string): string => {
  if (str.length <= 60) return str;
  return str.slice(0, 57) + "...";
};
