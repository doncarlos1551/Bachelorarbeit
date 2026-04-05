import type { BaselineOperation } from "src/app/operations";
import type {
  GateEvaluation,
  RiskResult,
  ValidationResult,
} from "src/msl/gates/gates.interfaces";
import type { DiffResult } from "src/msl/payload/diff.interfaces";

export type PlanStatus =
  | "preflighted"
  | "approved"
  | "blocked"
  | "rejected"
  | "applied"
  | "apply_failed";

// Ursprung des MCP-Tool-Calls für Audit und Frontend-Polling
export interface PlanMcpCall {
  name: string;
  args: Record<string, unknown>;
}

export interface PlanRecord {
  planId: string;
  sessionId: string;
  actorId: string;
  chatId?: string;
  projectId: string;
  adapterId: string;
  userComment?: string;
  status: PlanStatus;
  decision: "not_evaluated" | "approved" | "blocked" | "rejected";
  decisionReason?: string;
  approvalReasoning?: string;
  baselineHash: string;
  candidateHash: string;
  operations: BaselineOperation[];
  mcpCall?: PlanMcpCall;
  gates: GateEvaluation[];
  risk: RiskResult;
  diff: DiffResult;
  policyViolations: string[];
  validation: ValidationResult;
  createdAt: string;
  decidedAt?: string;
  appliedAt?: string;
}

export interface PlanEvent {
  eventId: string;
  planId: string;
  sessionId: string;
  eventType:
    | "preflight"
    | "decision"
    | "apply_success"
    | "apply_failure"
    | "note";
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface PlanUpdate {
  status?: PlanStatus;
  decision?: PlanRecord["decision"];
  decisionReason?: string;
  approvalReasoning?: string;
  decidedAt?: string;
  appliedAt?: string;
}

export interface PlanListFilter {
  sessionId: string;
  limit: number;
}
