import type { BaselineOperation } from "src/app/operations";
import type { MslPolicyConfig } from "src/msl/config";

export interface PreflightResult {
  passed: boolean;
  violations: string[];
  details?: Record<string, unknown>;
}

// === Pro-Op-Verdicts ===
// Pro Operation feasibility-Checks, geliefert mit Op-Index für LLM-Lenkung
// Aufgeteilt nach Heimat-Gate, Aufrufer mergt zu policy/preflight/validation
// - policyErrors: allowedKinds und deniedKinds (Single-Source)
// - preflightErrors: Missing-Entity (Komponente nicht in Baseline ausser ui.add_component)
// - validationErrors: Mustache-Syntax (Single-Source)
export interface OpLevelInput {
  operations: BaselineOperation[];
  existingEntityIds: Set<string>;
  policy: MslPolicyConfig;
  // Original-Indexe der parsedOperations im LLM-Batch
  // wenn gesetzt bestimmt operationIndex im OpVerdict sonst Identity
  operationIndexes?: number[];
}

export interface VerdictPartition {
  policyErrors: string[];
  preflightErrors: string[];
  validationErrors: string[];
}
