import type { BaselineOperation } from "src/app/operations";
import type {
  ValidationWarning,
  WarningSeverity,
} from "src/msl/gates/gates.interfaces";

// === Validation Gate ===
// Pre-Snapshot-Validierung, Kategorie infeasibility
// - Mustache-Syntax-Check (balanciert, nicht verschachtelt) als single-source
// - Warning-Severity-Sort und Wire-Renderer

interface MustacheTarget {
  field: string;
  raw: string;
}

interface MustacheError {
  field: string;
  problem: "unbalanced" | "nested";
  raw: string;
}

const checkMustacheString = (
  value: string,
): { balanced: boolean; nested: boolean } => {
  const openCount = (value.match(/\{\{/g) ?? []).length;
  const closeCount = (value.match(/\}\}/g) ?? []).length;
  const balanced = openCount === closeCount;
  let depth = 0;
  let nested = false;
  for (let index = 0; index < value.length - 1; index += 1) {
    if (value[index] === "{" && value[index + 1] === "{") {
      depth += 1;
      if (depth > 1) {
        nested = true;
        break;
      }
      index += 1;
    } else if (value[index] === "}" && value[index + 1] === "}") {
      depth = Math.max(0, depth - 1);
      index += 1;
    }
  }
  return { balanced, nested };
};

const collectMustacheTargets = (
  operation: BaselineOperation,
): MustacheTarget[] => {
  if (operation.kind === "ui.update_component_text") {
    return [{ field: "ui.update_component_text.text", raw: operation.text }];
  }
  if (
    operation.kind === "ui.update_component_property" &&
    typeof operation.value === "string"
  ) {
    return [
      {
        field: "ui.update_component_property.value",
        raw: operation.value,
      },
    ];
  }
  if (operation.kind === "ui.add_component") {
    const targets: MustacheTarget[] = [];
    // properties hat zod-default {} aber Aufruf ausserhalb der zod-pipeline können undefined liefern (zB Tests, interne Migrationen)
    const properties = operation.properties ?? {};
    for (const [propertyName, propertyValue] of Object.entries(properties)) {
      if (typeof propertyValue === "string") {
        targets.push({
          field: `ui.add_component.properties.${propertyName}`,
          raw: propertyValue,
        });
      }
    }
    return targets;
  }
  return [];
};

const findMustacheErrors = (operation: BaselineOperation): MustacheError[] => {
  const errors: MustacheError[] = [];
  for (const { field, raw } of collectMustacheTargets(operation)) {
    const { balanced, nested } = checkMustacheString(raw);
    if (!balanced) errors.push({ field, problem: "unbalanced", raw });
    if (nested) errors.push({ field, problem: "nested", raw });
  }
  return errors;
};

const formatMustacheError = (error: MustacheError): string => {
  if (error.problem === "unbalanced") {
    return `${error.field}: unbalancierte Mustache-Klammern ('${error.raw}').`;
  }
  return `${error.field}: verschachtelte Mustache-Blöcke ('${error.raw}'). Nur flache {{...}} erlaubt.`;
};

export const componentIdOf = (
  operation: BaselineOperation,
): string | undefined => {
  if ("componentId" in operation && typeof operation.componentId === "string") {
    const trimmed = operation.componentId.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
};

export const checkOperationMustache = (
  operation: BaselineOperation,
): string[] => findMustacheErrors(operation).map(formatMustacheError);

const SEVERITY_RANK: Record<WarningSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export const sortWarningsBySeverity = (
  warnings: ValidationWarning[],
): ValidationWarning[] =>
  [...warnings].sort(
    (left, right) =>
      SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity],
  );

const SEVERITY_LABELS: Record<WarningSeverity, string> = {
  high: "[HIGH]",
  medium: "[MEDIUM]",
  low: "[LOW]",
};

// @ToDo Frontend liest typed Warnings
export const renderWarningForWire = (warning: ValidationWarning): string =>
  `${SEVERITY_LABELS[warning.severity]} ${warning.message}`;

export const renderWarningsForWire = (
  warnings: ValidationWarning[],
): string[] => warnings.map(renderWarningForWire);
