import type {
  GateMode,
  GateModes,
  GateEvaluation,
  OpVerdict,
  SchemaIssue,
} from "src/msl/gates/gates.interfaces";
import {
  GATE_CATEGORIES,
  isInfeasibleVerdict,
  verdictErrors,
} from "src/msl/gates/gates.interfaces";
import type {
  OpLevelInput,
  VerdictPartition,
} from "src/msl/gates/shared.interfaces";
import {
  checkOperationMustache,
  componentIdOf,
} from "src/msl/gates/validation";

// === Shared Gate-Helpers ===
// Bausteine für GateModules

export type { PolicyResult } from "src/msl/gates/gates.interfaces";
export type {
  OpLevelInput,
  PreflightResult,
  VerdictPartition,
} from "src/msl/gates/shared.interfaces";

// @ToDo Konsistenz: 'Op' -> 'Operation' (Repo: 308x 'operation', 'Op' nur hier)
// computeOpVerdicts -> computeOperationVerdicts, OpLevelInput -> OperationLevelInput, OpVerdict -> OperationVerdict
// Scope: Definition + 5 Imports (gates/index, gates/{policy,validation,preflight}, core/{pipeline,core.interfaces}) + Call pipeline.ts:448
export const computeOpVerdicts = (input: OpLevelInput): OpVerdict[] => {
  return input.operations.map((operation, position) => {
    const operationIndex = input.operationIndexes?.[position] ?? position;
    const componentId = componentIdOf(operation);

    const policyErrors: string[] = [];
    if (
      input.policy.allowedKinds.length > 0 &&
      !input.policy.allowedKinds.includes(operation.kind)
    ) {
      policyErrors.push(
        `Operation-Kind '${operation.kind}' ist nicht in allowedKinds.`,
      );
    }
    if (input.policy.deniedKinds.includes(operation.kind)) {
      policyErrors.push(
        `Operation-Kind '${operation.kind}' ist durch Policy verboten.`,
      );
    }

    const preflightErrors: string[] = [];
    if (
      componentId &&
      operation.kind !== "ui.add_component" &&
      !input.existingEntityIds.has(componentId)
    ) {
      preflightErrors.push(
        `Komponente '${componentId}' existiert nicht in der Baseline. ` +
          `Aktuelle IDs via 'list_components' prüfen.`,
      );
    }

    const validationErrors = checkOperationMustache(operation);

    return {
      operationIndex,
      opKind: operation.kind,
      ...(componentId ? { componentId } : {}),
      policyErrors,
      preflightErrors,
      validationErrors,
    };
  });
};

const formatPerOp = (verdict: OpVerdict, errorMessage: string): string => {
  const idHint = verdict.componentId
    ? ` componentId='${verdict.componentId}'`
    : "";
  return `[op #${verdict.operationIndex} ${verdict.opKind}${idHint}] ${errorMessage}`;
};

export const partitionVerdictErrors = (
  verdicts: OpVerdict[],
): VerdictPartition => ({
  policyErrors: verdicts.flatMap((verdict) =>
    verdict.policyErrors.map((errorMessage) =>
      formatPerOp(verdict, errorMessage),
    ),
  ),
  preflightErrors: verdicts.flatMap((verdict) =>
    verdict.preflightErrors.map((errorMessage) =>
      formatPerOp(verdict, errorMessage),
    ),
  ),
  validationErrors: verdicts.flatMap((verdict) =>
    verdict.validationErrors.map((errorMessage) =>
      formatPerOp(verdict, errorMessage),
    ),
  ),
});

// LLM-Fehlertext aus Verdict-Vektor und optionaler Schema-Issue-Liste schema-Errors werden als zusaetzliche Pseudo-Verdicts vor MSL-Verdicts gelistet
// -> totalOps reflektiert die Original-Batch-Größe inklusive schema-Failures
export const formatInfeasibleVerdicts = (
  verdicts: OpVerdict[],
  schemaIssues: SchemaIssue[] = [],
  maxShown = 8,
): string => {
  const infeasible = verdicts.filter(isInfeasibleVerdict);
  const totalIssues = infeasible.length + schemaIssues.length;
  if (totalIssues === 0) return "";
  const totalOps = verdicts.length + schemaIssues.length;

  const schemaLines = schemaIssues.map(
    (issue) =>
      `[op #${issue.operationIndex} ${issue.opKind}] schema: ${issue.errors.join("; ")}`,
  );
  const verdictLines = infeasible.map((verdict) => {
    const idHint = verdict.componentId
      ? ` componentId='${verdict.componentId}'`
      : "";
    return `[op #${verdict.operationIndex} ${verdict.opKind}${idHint}] ${verdictErrors(verdict).join("; ")}`;
  });
  const allLines = [...schemaLines, ...verdictLines];
  const shown = allLines.slice(0, maxShown);
  const rest =
    allLines.length > maxShown
      ? ` (+${allLines.length - maxShown} weitere)`
      : "";
  return `${totalIssues} von ${totalOps} Operationen sind strukturell nicht durchführbar:${rest}\n${shown.join("\n")}`;
};

export const parseHost = (raw: string): string | undefined => {
  try {
    return new URL(raw).host;
  } catch {
    return undefined;
  }
};

export const buildGateResult = (
  gate: keyof GateModes,
  mode: GateMode,
  passed: boolean,
  reason?: string,
  details?: Record<string, unknown>,
): GateEvaluation => {
  const category = GATE_CATEGORIES[gate];
  if (mode === "off") {
    return {
      gate,
      mode,
      category,
      evaluated: false,
      passed: true,
      blocked: false,
      details,
    };
  }
  const blocked = !passed && mode === "enforce";
  return {
    gate,
    mode,
    category,
    evaluated: true,
    passed,
    blocked,
    reason: !passed ? reason : undefined,
    details,
  };
};
