import {
  applyOperationToApplicationDsl,
  listComponentsFromApplicationDsl,
  listQueriesFromApplicationDsl,
  summarizeApplicationDsl,
} from "src/adapters/lowcoder/dsl";
import { computeStructuralDiff } from "src/adapters/lowcoder/dsl-diff";
import {
  buildDependencyGraph,
  analyzeBlastRadius,
} from "src/adapters/lowcoder/dependency-graph";
import type {
  AdapterBatchFinalize,
  AdapterBatchValidator,
  AdapterPerOpValidation,
  MslAdapter,
} from "src/msl/adapter/adapter.interfaces";
import type {
  ImpactDependent,
  ImpactInfo,
  ValidationWarning,
} from "src/msl/gates/gates.interfaces";
import type { DiffResult } from "src/msl/payload/diff.interfaces";
import type { BaselineOperation } from "src/app/operations";
import { isRecord, type JsonRecord } from "src/shared/utils";

export class LowcoderMslAdapter implements MslAdapter<
  BaselineOperation,
  JsonRecord
> {
  readonly adapterId = "lowcoder-api";

  listEntityIds(baselineSnapshot: JsonRecord): Set<string> {
    const ids = new Set<string>();
    for (const entry of listComponentsFromApplicationDsl(baselineSnapshot)) {
      const componentId = readStringField(entry, "componentId").trim();
      if (componentId.length > 0) ids.add(componentId);
    }
    return ids;
  }

  preflight(input: {
    baselineSnapshot: JsonRecord;
    operations: BaselineOperation[];
  }): {
    nextSnapshot: JsonRecord;
    steps: Array<Record<string, unknown>>;
    summary: Record<string, unknown>;
  } {
    let nextSnapshot = structuredClone(input.baselineSnapshot);
    const steps: Array<Record<string, unknown>> = [];

    for (const operation of input.operations) {
      const applied = applyOperationToApplicationDsl(nextSnapshot, operation);
      nextSnapshot = applied.nextDsl;
      steps.push(applied.details);
    }

    return {
      nextSnapshot,
      steps,
      summary: summarizeApplicationDsl(nextSnapshot),
    };
  }

  diff(input: {
    baselineSnapshot: JsonRecord;
    candidateSnapshot: JsonRecord;
    operations: BaselineOperation[];
  }): DiffResult {
    const before = summarizeApplicationDsl(input.baselineSnapshot);
    const after = summarizeApplicationDsl(input.candidateSnapshot);
    const componentDiff = extractComponentDiff(input.operations);

    // RFC 6902 JSON-Patch-Vergleich mit Metadaten-Filter (Bryan und Nottingham 2013)
    const structural = computeStructuralDiff(
      input.baselineSnapshot,
      input.candidateSnapshot,
    );

    return {
      before,
      after,
      delta: {
        componentCount:
          readNumber(after.componentCount) - readNumber(before.componentCount),
        queryCount:
          readNumber(after.queryCount) - readNumber(before.queryCount),
        tempStateCount:
          readNumber(after.tempStateCount) - readNumber(before.tempStateCount),
        jsLibraryCount:
          readNumber(after.jsLibraryCount) - readNumber(before.jsLibraryCount),
      },
      operationKinds: input.operations.map((operation) => operation.kind),
      affectedObjects: extractAffectedObjects(input.operations),
      externalEndpoints: componentDiff.externalEndpoints,
      diffSummary: buildDiffSummary(input.operations, componentDiff),
      structuralDiff: {
        humanSummary: structural.humanSummary,
        humanEntries: structural.humanEntries
          .filter(isNonMetadataEntry)
          .map((entry) => ({
            headline: entry.headline,
            kind: entry.kind,
            ...(entry.subjectName ? { subjectName: entry.subjectName } : {}),
            ...(entry.propertyName ? { propertyName: entry.propertyName } : {}),
            ...(entry.oldValue !== undefined
              ? { oldValue: entry.oldValue }
              : {}),
            ...(entry.newValue !== undefined
              ? { newValue: entry.newValue }
              : {}),
            ...(entry.multiline !== undefined
              ? { multiline: entry.multiline }
              : {}),
            path: entry.path,
            category: entry.category,
          })),
        counts: structural.counts,
      },
    };
  }

  // Map-Reduce-Validierung
  // -> Snapshot-Sets einmal vorberechnet dann pro Operation wiederverwendet
  beginValidation(input: {
    baselineSnapshot: JsonRecord;
    candidateSnapshot: JsonRecord;
    operations: BaselineOperation[];
  }): AdapterBatchValidator<BaselineOperation> {
    const candidateComponentIds = new Set(
      listComponentsFromApplicationDsl(input.candidateSnapshot)
        .map((entry) => readStringField(entry, "componentId").trim())
        .filter((componentId) => componentId.length > 0),
    );
    const queryNames = new Set(
      listQueriesFromApplicationDsl(input.candidateSnapshot)
        .map((entry) => readStringField(entry, "name").trim())
        .filter((name) => name.length > 0),
    );
    const tempStateNames = new Set(listTempStateNames(input.candidateSnapshot));

    return {
      validateOperation: ({ operation, opIndex }): AdapterPerOpValidation => {
        const errors: string[] = [];
        const warnings: ValidationWarning[] = [];

        if (
          operation.kind === "ui.rename_component" &&
          typeof operation.newComponentId === "string"
        ) {
          const newId = operation.newComponentId.trim();
          if (newId.length > 0 && !candidateComponentIds.has(newId)) {
            warnings.push({
              severity: "medium",
              kind: "rename_target_missing",
              message: `Rename-Ziel '${newId}' ist nach Preflight nicht vorhanden (vermutlich vorher umbenannt oder Kollision).`,
              opIndex,
            });
          }
        }

        if (operation.kind === "ui.upsert_binding") {
          const stripped = stripMoustache(operation.expression);
          const firstSegment = stripped.match(
            /^([A-Za-z_][A-Za-z0-9_]*)\./,
          )?.[1];
          if (
            firstSegment &&
            !isKnownBindingRoot(firstSegment, tempStateNames)
          ) {
            warnings.push({
              severity: "low",
              kind: "binding_unknown",
              message: `Binding '${operation.bindingKey}' on '${operation.componentId}' references unknown root '${firstSegment}'.`,
              opIndex,
            });
          }
          if (stripped.includes("process.env")) {
            warnings.push({
              severity: "medium",
              kind: "binding_env",
              message: `Binding '${operation.bindingKey}' on '${operation.componentId}' references process.env.`,
              opIndex,
            });
          }
          if (stripped.includes("window.localStorage")) {
            warnings.push({
              severity: "low",
              kind: "binding_storage",
              message: `Binding '${operation.bindingKey}' on '${operation.componentId}' references localStorage.`,
              opIndex,
            });
          }
        }

        if (operation.kind === "logic.set_component_action") {
          const functionCall = operation.script.match(
            /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/,
          )?.[1];
          if (functionCall && !queryNames.has(functionCall)) {
            warnings.push({
              severity: "low",
              kind: "binding_unknown",
              message: `Action '${operation.actionName}' references '${functionCall}()', but no matching query/function exists.`,
              opIndex,
            });
          }
        }

        if (operation.kind === "logic.upsert_function") {
          if (!operation.code.includes("return")) {
            warnings.push({
              severity: "low",
              kind: "function_no_return",
              message: `Function '${operation.functionName}' has no explicit return statement.`,
              opIndex,
            });
          }
        }

        if (
          operation.kind === "preload.set_script" &&
          operation.script.includes("eval(")
        ) {
          warnings.push({
            severity: "high",
            kind: "preload_eval",
            message: "Preload script contains eval(...).",
            opIndex,
          });
        }

        if (operation.kind === "integration.upsert_http_datasource") {
          if (!isAbsoluteHttpUrl(operation.url)) {
            errors.push(
              `Datasource URL '${operation.url}' must be an absolute http/https URL.`,
            );
          }
        }

        return { errors, warnings };
      },

      // Dependency-Graph (Bohner und Arnold 1996, Van der Wal 2022, Romano et al. 2020)
      finalize: (): AdapterBatchFinalize => {
        const errors: string[] = [];
        const warnings: ValidationWarning[] = [];
        const impacts: ImpactInfo[] = [];

        const deleteOperations = input.operations.filter(
          (operation) => operation.kind === "ui.remove_component",
        );
        const renameOperations = input.operations.filter(
          (operation) => operation.kind === "ui.rename_component",
        );

        if (deleteOperations.length === 0 && renameOperations.length === 0) {
          return { errors, warnings, impacts };
        }

        const graph = buildDependencyGraph(input.baselineSnapshot);

        for (const operation of deleteOperations) {
          const blast = analyzeBlastRadius(graph, operation.componentId);
          if (blast.directDependents > 0) {
            const dependents: ImpactDependent[] = blast.dependentDetails
              .slice(0, 5)
              .map((dependent) => ({
                name: dependent.nodeName,
                edgeType: dependent.edgeType,
              }));
            const detailText = dependents
              .map((dependent) => `${dependent.name} (${dependent.edgeType})`)
              .join(", ");
            impacts.push({
              kind: blast.hasTransitiveDependents ? "cascade" : "direct",
              componentId: operation.componentId,
              dependents,
              message: blast.hasTransitiveDependents
                ? `Löschung von '${operation.componentId}' betrifft ${blast.directDependents} Abhängigkeit(en) (transitive Kaskade): ${detailText}.`
                : `Löschung von '${operation.componentId}' betrifft ${blast.directDependents} Abhängigkeit(en): ${detailText}.`,
            });
          }
        }

        for (const operation of renameOperations) {
          const blast = analyzeBlastRadius(graph, operation.componentId);
          if (blast.directDependents > 0) {
            const dependents: ImpactDependent[] = blast.dependentDetails
              .slice(0, 5)
              .map((dependent) => ({
                name: dependent.nodeName,
                edgeType: dependent.edgeType,
              }));
            const detailText = dependents
              .map((dependent) => `${dependent.name} (${dependent.edgeType})`)
              .join(", ");
            impacts.push({
              kind: "direct",
              componentId: operation.componentId,
              dependents,
              message: `Umbenennung von '${operation.componentId}' -> '${operation.newComponentId}' betrifft ${blast.directDependents} Referenz(en): ${detailText}. Diese müssen manuell aktualisiert werden.`,
            });
          }
        }

        return { errors, warnings, impacts };
      },
    };
  }
}

const readNumber = (value: unknown): number => {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

const stripMoustache = (expression: string): string => {
  const trimmed = expression.trim();
  if (trimmed.startsWith("{{") && trimmed.endsWith("}}")) {
    return trimmed.slice(2, -2).trim();
  }
  return trimmed;
};

const isKnownBindingRoot = (
  root: string,
  tempStateNames: Set<string>,
): boolean => {
  if (tempStateNames.has(root)) {
    return true;
  }
  return [
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
  ].includes(root);
};

const listTempStateNames = (applicationDsl: JsonRecord): string[] => {
  const tempStates = Array.isArray(applicationDsl.tempStates)
    ? applicationDsl.tempStates
    : [];
  return tempStates
    .filter(isRecord)
    .map((entry) => readStringField(entry, "name").trim())
    .filter((name) => name.length > 0);
};

const readStringField = (
  record: Record<string, unknown>,
  key: string,
  fallback = "",
): string => {
  const value = record[key];
  return typeof value === "string" ? value : fallback;
};

const extractAffectedObjects = (operations: BaselineOperation[]): string[] => {
  const objects = new Set<string>();
  for (const operation of operations) {
    if (
      "componentId" in operation &&
      typeof operation.componentId === "string"
    ) {
      objects.add(`component:${operation.componentId}`);
    }
    if (
      "functionName" in operation &&
      typeof operation.functionName === "string"
    ) {
      objects.add(`function:${operation.functionName}`);
    }
    if (
      "datasourceId" in operation &&
      typeof operation.datasourceId === "string"
    ) {
      objects.add(`datasource:${operation.datasourceId}`);
    }
    if ("stateName" in operation && typeof operation.stateName === "string") {
      objects.add(`tempState:${operation.stateName}`);
    }
    // preload-Operationss haben keine ID werden über kind-suffix gekennzeichnet
    if (operation.kind.startsWith("preload.")) {
      const subjectKind = operation.kind.slice("preload.".length);
      objects.add(`preload:${subjectKind}`);
    }
  }
  return [...objects];
};

interface ComponentDiff {
  addedComponents: string[];
  removedComponents: string[];
  modifiedComponents: string[];
  externalEndpoints: string[];
}

const extractComponentDiff = (
  operations: BaselineOperation[],
): ComponentDiff => {
  const added = new Set<string>();
  const removed = new Set<string>();
  const modified = new Set<string>();
  const endpoints = new Set<string>();

  for (const operation of operations) {
    switch (operation.kind) {
      case "ui.add_component":
        added.add(operation.componentId ?? operation.componentType);
        break;
      case "ui.remove_component":
        removed.add(operation.componentId);
        break;
      case "ui.update_component_text":
      case "ui.update_component_property":
      case "ui.upsert_binding":
      case "ui.move_component":
        modified.add(operation.componentId);
        break;
      case "ui.rename_component":
        modified.add(`${operation.componentId} -> ${operation.newComponentId}`);
        break;
      case "logic.set_component_action":
        modified.add(operation.componentId);
        break;
      case "integration.upsert_http_datasource":
        endpoints.add(operation.url);
        break;
      case "logic.upsert_function": {
        const urlMatches = operation.code.match(/https?:\/\/[^\s'")\]]+/g);
        if (urlMatches) urlMatches.forEach((url) => endpoints.add(url));
        break;
      }
      case "preload.set_script": {
        const urlMatches = operation.script.match(/https?:\/\/[^\s'")\]]+/g);
        if (urlMatches) urlMatches.forEach((url) => endpoints.add(url));
        break;
      }
      default:
        break;
    }
  }

  return {
    addedComponents: [...added],
    removedComponents: [...removed],
    modifiedComponents: [...modified],
    externalEndpoints: [...endpoints],
  };
};

const buildDiffSummary = (
  operations: BaselineOperation[],
  componentDiff: ComponentDiff,
): string => {
  const parts: string[] = [];
  if (componentDiff.addedComponents.length > 0) {
    parts.push(
      `${componentDiff.addedComponents.length} Komponente(n) hinzugefügt`,
    );
  }
  if (componentDiff.removedComponents.length > 0) {
    parts.push(
      `${componentDiff.removedComponents.length} Komponente(n) entfernt`,
    );
  }
  if (componentDiff.modifiedComponents.length > 0) {
    parts.push(
      `${componentDiff.modifiedComponents.length} Komponente(n) geändert`,
    );
  }
  if (componentDiff.externalEndpoints.length > 0) {
    parts.push(
      `${componentDiff.externalEndpoints.length} externe(r) Endpunkt(e)`,
    );
  }
  const functionCount = operations.filter(
    (operation) => operation.kind === "logic.upsert_function",
  ).length;
  if (functionCount > 0) parts.push(`${functionCount} Funktion(en)`);
  const preloadCount = operations.filter((operation) =>
    operation.kind.startsWith("preload."),
  ).length;
  if (preloadCount > 0) parts.push(`${preloadCount} Preload-Änderung(en)`);
  return parts.join(", ") || `${operations.length} Operation(en)`;
};

type StructuralEntry = ReturnType<
  typeof computeStructuralDiff
>["humanEntries"][number];

const isNonMetadataEntry = (
  entry: StructuralEntry,
): entry is StructuralEntry & { category: "semantic" | "structural" } =>
  entry.category !== "metadata";

const isAbsoluteHttpUrl = (raw: string): boolean => {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};
