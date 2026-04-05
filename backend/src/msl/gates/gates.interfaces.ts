export type GateMode = "off" | "observe" | "enforce";
export type RuntimeRiskLevel = "low" | "medium" | "high";

export interface GateModes {
  policy: GateMode;
  preflight: GateMode;
  diff: GateMode;
  risk: GateMode;
  validation: GateMode;
  approval: GateMode;
  audit: GateMode;
}

export type GateCategory = "infeasibility" | "risky" | "audit";

export const GATE_CATEGORIES: Record<keyof GateModes, GateCategory> = {
  policy: "infeasibility",
  preflight: "infeasibility",
  diff: "audit",
  risk: "audit",
  validation: "infeasibility",
  approval: "risky",
  audit: "audit",
};

export interface GateEvaluation {
  gate: keyof GateModes;
  mode: GateMode;
  category: GateCategory;
  evaluated: boolean;
  passed: boolean;
  blocked: boolean;
  reason?: string;
  details?: Record<string, unknown>;
}

export const RISK_TAGS = [
  "R_DELETE",
  "R_SCRIPT",
  "R_ACTION",
  "R_PRELOAD",
  "R_EXTERNAL_IO",
  "R_REFERENCE",
  "R_CONTENT_INJECTION",
  "R_CONTENT_SUSPICIOUS",
  "R_BULK_CHANGE",
  "R_CASCADE_IMPACT",
  "R_EXCLUSIVE_LOCK",
] as const;
export type RiskTag = (typeof RISK_TAGS)[number];

const RISK_TAG_SET: ReadonlySet<string> = new Set(RISK_TAGS);

export const isRiskTag = (value: unknown): value is RiskTag =>
  typeof value === "string" && RISK_TAG_SET.has(value);

export interface PolicyResult {
  passed: boolean;
  violations: string[];
}

export type WarningSeverity = "low" | "medium" | "high";

export type WarningKind =
  | "content_pattern"
  | "binding_unknown"
  | "binding_env"
  | "binding_storage"
  | "function_no_return"
  | "preload_eval"
  | "rename_target_missing"
  | "general";

export interface ValidationWarning {
  severity: WarningSeverity;
  kind: WarningKind;
  message: string;
  opIndex?: number;
}

export interface ValidationResult {
  passed: boolean;
  errors: string[];
  warnings: ValidationWarning[];
}

export interface RiskResult {
  level: RuntimeRiskLevel;
  score: number;
  tags: RiskTag[];
  reasons: string[];
  requiresApproval: boolean;
}

// === Cascade-Impacts (Bohner und Arnold 1996) ===

export type ImpactKind = "direct" | "cascade";

export interface ImpactDependent {
  name: string;
  edgeType: string;
}

export interface ImpactInfo {
  kind: ImpactKind;
  componentId: string;
  dependents: ImpactDependent[];
  message: string;
}

// === Op-Verdicts (Pro-Op-Feasibility) ===

export interface OpVerdict {
  operationIndex: number;
  opKind: string;
  componentId?: string;
  policyErrors: string[];
  preflightErrors: string[];
  validationErrors: string[];
}

export const isInfeasibleVerdict = (verdict: OpVerdict): boolean =>
  verdict.policyErrors.length +
    verdict.preflightErrors.length +
    verdict.validationErrors.length >
  0;

export const verdictErrors = (verdict: OpVerdict): string[] => [
  ...verdict.policyErrors,
  ...verdict.preflightErrors,
  ...verdict.validationErrors,
];

// === Schema-Issues (per-Op aus zod safeParse) ===
// operationIndex bezieht sich auf die Original-Position im LLM-Batch
// vor Filterung der schemaOK-Subset
export interface SchemaIssue {
  operationIndex: number;
  opKind: string;
  errors: string[];
}
