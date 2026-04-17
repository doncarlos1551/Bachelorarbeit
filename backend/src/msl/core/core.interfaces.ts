import type { BaselineOperation } from "src/app/operations";
import type { JsonRecord } from "src/shared/utils";
import type {
  PolicyResult,
  SchemaIssue,
  ValidationResult,
} from "src/msl/gates/gates.interfaces";
import type { PreflightResult } from "src/msl/gates/shared.interfaces";
import type { MslAdapter } from "src/msl/adapter/adapter.interfaces";
import type { MslPayload } from "src/msl/payload/payload.interfaces";
import type { PlanRecord } from "src/msl/plan/plan.interfaces";
import type { MslStore } from "src/msl/store/store.interfaces";
import type { MslConfig } from "src/msl/config";
import type { scanOperationsForDangerousContent } from "src/msl/content-scanner";
import type { computeOpVerdicts } from "src/msl/gates/index";

export interface ProcessInput {
  projectId: string;
  actorId: string;
  sessionId?: string;
  chatId?: string;
  userComment?: string;
  operations: BaselineOperation[];
  baselineDsl: JsonRecord;
  mcpCall?: { name: string; args: Record<string, unknown> };
  // Per-Operation-Schema-Fehler aus mcp-server (zod safeParse)
  // - schemaIssues triggern Stufe-2-Fail-Fast zusammen mit MSL-Gates
  // - operationIndexes mappt parsed-Operation-Position auf Original-Batch-Index
  schemaIssues?: SchemaIssue[];
  operationIndexes?: number[];
}

export interface ProcessResult {
  mode: "baseline_direct_apply" | "msl_guarded_apply" | "msl_manual_plan";
  nextDsl: JsonRecord;
  steps: Array<Record<string, unknown>>;
  summary: Record<string, unknown>;
  msl: MslPayload;
}

export interface MslCoreOptions {
  adapter: MslAdapter<BaselineOperation, JsonRecord>;
  config?: MslConfig;
  store?: MslStore;
  onPlanEvent?: (event: MslPlanLifecycleEvent) => void;
}

export interface MslPlanLifecycleEvent {
  eventType:
    | "plan.created"
    | "plan.decision"
    | "plan.applied"
    | "plan.apply_failed";
  at: string;
  planId: string;
  sessionId: string;
  projectId: string;
  status: PlanRecord["status"];
  decision: PlanRecord["decision"];
  reason?: string;
  payload?: Record<string, unknown>;
}

export interface GlobalQueueSessionView {
  sessionId: string;
  openCount: number;
  latestOpenAt?: string;
  projectIds: string[];
  openPlans: PlanRecord[];
}

// Aggregat aus Stufe 1 (Pre-Snapshot-Prüfung)
// Pro-Operation-Verdicts und alle drei Pre-Snapshot-Gates plus Lock und Content-Scan
// wird einmalig vor Stufe 2 berechnet und durch alle Folge-Stufen gereicht
export interface PreSnapshotResult {
  recentSamePlanCount: number;
  openPlanCount: number;
  lockViolation?: string;
  existingEntityIds: Set<string>;
  contentScanResults: ReturnType<typeof scanOperationsForDangerousContent>;
  opVerdicts: ReturnType<typeof computeOpVerdicts>;
  policy: PolicyResult;
  preflightGate: PreflightResult;
  genericValidation: ValidationResult;
  operationKinds: string[];
  baselineHash: string;
}
