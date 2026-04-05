import type {
  GateEvaluation,
  GateModes,
  RiskResult,
  RiskTag,
  RuntimeRiskLevel,
} from "src/msl/gates/gates.interfaces";
import type { DiffResult } from "src/msl/payload/diff.interfaces";

export interface ApprovalReasoningStructured {
  riskScore: number;
  riskLevel: RuntimeRiskLevel;
  reasons: string[];
  tags: RiskTag[];
  policyViolations: string[];
  warnings: string[];
  errors: string[];
  externalEndpoints: string[];
  recommendations: string[];
  changes: string[];
}

// MslPayload immer von Backend an Frontend gespiegelt
export interface MslPayload {
  enabled: boolean;
  decision: "not_evaluated" | "approved" | "blocked" | "rejected";
  reason?: string;
  reviewerComment?: string;
  executionMode?: "auto" | "manual";
  requiresManualApply?: boolean;
  planId?: string;
  sessionId?: string;
  baselineHash?: string;
  candidateHash?: string;
  gateModes?: GateModes;
  gates?: GateEvaluation[];
  risk?: RiskResult;
  diff?: DiffResult;
  approvalReasoning?: string;
  approvalReasoningStructured?: ApprovalReasoningStructured;
}
