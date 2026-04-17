import { randomUUID } from "node:crypto";
import type { JsonRecord } from "src/shared/utils";
import type { PlanRecord } from "src/msl/plan/plan.interfaces";
import { MslRejectionError, PlanNotApprovedError } from "src/msl/errors";
import { hashObject, isOpenPlanStatus } from "src/msl/utils";
import type { MslCore } from "src/msl/core/core";
import type { MslPlanLifecycleEvent } from "src/msl/core/core.interfaces";

const CLEANUP_SCAN_LIMIT = 500;

export const emitPlanEvent = (
  core: MslCore,
  event: MslPlanLifecycleEvent,
): void => {
  try {
    core.onPlanEvent?.(event);
  } catch {
    // LifecycleEventSink darf RuntimeFlow nicht stoppen
  }
};

export const approvePlan = async (
  core: MslCore,
  input: {
    planId: string;
    actorId: string;
    reason?: string;
  },
): Promise<PlanRecord> => {
  const plan = await core.store.getPlan(input.planId);
  if (!plan) {
    throw new Error(`Plan '${input.planId}' not found.`);
  }
  // applied, blocked, rejected sind final
  // preflighted, approved, apply_failed sind vom User änderbar
  if (plan.status === "applied") {
    throw new MslRejectionError(
      `Plan '${input.planId}' ist bereits angewendet und kann nicht erneut freigegeben werden.`,
      { planId: input.planId },
    );
  }
  if (plan.status === "blocked") {
    // infeasibility-Block ist nicht übersteuerbar
    // risky-Block in Auto-Mode bewusst final
    const blockingGate = plan.gates.find((gate) => gate.blocked);
    const isInfeasibility = blockingGate?.category === "infeasibility";
    const reasonText = isInfeasibility
      ? `Plan '${input.planId}' ist strukturell nicht durchführbar (Gate '${blockingGate?.gate}': ${plan.decisionReason ?? "unbekannter Grund"}). User-Override ist in diesem Fall nicht möglich.`
      : `Plan '${input.planId}' wurde durch ein Gate hart blockiert (${plan.decisionReason ?? "unbekannter Grund"}) und kann nicht nachtraeglich freigegeben werden.`;
    throw new MslRejectionError(reasonText, { planId: input.planId });
  }
  if (plan.status === "rejected") {
    throw new MslRejectionError(
      `Plan '${input.planId}' wurde bereits abgelehnt (${plan.decisionReason ?? "unbekannter Grund"}) und kann nicht nachtraeglich freigegeben werden.`,
      { planId: input.planId },
    );
  }
  const at = new Date().toISOString();
  // decisionReason explizit überschreiben sonst bleibt PlanCreateText stehen
  const approvalReason =
    input.reason?.trim() || `Approved by ${input.actorId}.`;
  await core.store.updatePlan(input.planId, {
    status: "approved",
    decision: "approved",
    decisionReason: approvalReason,
    decidedAt: at,
  });
  await core.store.appendPlanEvent({
    eventId: randomUUID(),
    planId: input.planId,
    sessionId: plan.sessionId,
    eventType: "decision",
    payload: {
      actorId: input.actorId,
      decision: "approved",
      reason: input.reason,
      at,
    },
    createdAt: at,
  });
  const updated = await core.store.getPlan(input.planId);
  if (!updated) {
    throw new Error(
      `Plan '${input.planId}' disappeared after approval update.`,
    );
  }
  emitPlanEvent(core, {
    eventType: "plan.decision",
    at,
    planId: updated.planId,
    sessionId: updated.sessionId,
    projectId: updated.projectId,
    status: updated.status,
    decision: updated.decision,
    reason: input.reason,
    payload: {
      actorId: input.actorId,
    },
  });
  return updated;
};

export const rejectPlan = async (
  core: MslCore,
  input: {
    planId: string;
    actorId: string;
    reason?: string;
  },
): Promise<PlanRecord> => {
  const plan = await core.store.getPlan(input.planId);
  if (!plan) {
    throw new Error(`Plan '${input.planId}' not found.`);
  }
  const at = new Date().toISOString();
  await core.store.updatePlan(input.planId, {
    status: "rejected",
    decision: "rejected",
    decisionReason: input.reason,
    decidedAt: at,
  });
  await core.store.appendPlanEvent({
    eventId: randomUUID(),
    planId: input.planId,
    sessionId: plan.sessionId,
    eventType: "decision",
    payload: {
      actorId: input.actorId,
      decision: "rejected",
      reason: input.reason,
      at,
    },
    createdAt: at,
  });
  const updated = await core.store.getPlan(input.planId);
  if (!updated) {
    throw new Error(`Plan '${input.planId}' disappeared after reject update.`);
  }
  emitPlanEvent(core, {
    eventType: "plan.decision",
    at,
    planId: updated.planId,
    sessionId: updated.sessionId,
    projectId: updated.projectId,
    status: updated.status,
    decision: updated.decision,
    reason: input.reason,
    payload: {
      actorId: input.actorId,
    },
  });
  return updated;
};

export const cleanupOpenPlans = async (
  core: MslCore,
  input: {
    scope: "all" | "session";
    sessionId?: string;
    reason: string;
    actorId: string;
  },
): Promise<number> => {
  const candidates =
    input.scope === "session" && input.sessionId
      ? await core.store.listPlansBySession({
          sessionId: input.sessionId,
          limit: CLEANUP_SCAN_LIMIT,
        })
      : await core.store.listPlans(CLEANUP_SCAN_LIMIT);
  const open = candidates.filter((plan) => isOpenPlanStatus(plan.status));
  for (const plan of open) {
    await rejectPlan(core, {
      planId: plan.planId,
      actorId: input.actorId,
      reason: input.reason,
    });
  }
  return open.length;
};

export const preparePlanApply = async (
  core: MslCore,
  input: {
    planId: string;
    baselineDsl: JsonRecord;
  },
): Promise<{
  plan: PlanRecord;
  nextDsl: JsonRecord;
  steps: Array<Record<string, unknown>>;
  summary: Record<string, unknown>;
}> => {
  const plan = await core.store.getPlan(input.planId);
  if (!plan) {
    throw new Error(`Plan '${input.planId}' not found.`);
  }
  if (plan.status !== "approved") {
    throw new PlanNotApprovedError(input.planId, plan.status);
  }

  // nur warnen, nicht blocken
  // Lowcoder schreibt Metadaten (updatedAt, gid) zurück unverändert
  const currentHash = hashObject(input.baselineDsl);
  const baselineMismatch = currentHash !== plan.baselineHash;
  if (baselineMismatch) {
    console.warn(
      `[MSL] Plan '${input.planId}' baseline hash drift (stored=${plan.baselineHash.slice(0, 12)}..., current=${currentHash.slice(0, 12)}...). ` +
        `Proceeding, Lowcoder API roundtrip may add metadata.`,
    );
  }

  // Preflight neu rechnen für aktuellen CandidateSnapshot
  const preflight = core.adapter.preflight({
    baselineSnapshot: input.baselineDsl,
    operations: plan.operations,
  });

  // warnen nicht blocken
  // angewandt werden exakt die Operations aus dem gecheckten Plan
  const candidateHash = hashObject(preflight.nextSnapshot);
  if (candidateHash !== plan.candidateHash) {
    console.warn(
      `[MSL] Plan '${input.planId}' candidate hash drift (stored=${plan.candidateHash.slice(0, 12)}..., computed=${candidateHash.slice(0, 12)}...). ` +
        `Proceeding, operations are identical, hash drift from Lowcoder metadata.`,
    );
  }

  return {
    plan,
    nextDsl: preflight.nextSnapshot,
    steps: preflight.steps,
    summary: preflight.summary,
  };
};

export const markPlanApplied = async (
  core: MslCore,
  planId: string,
  context: { sessionId: string; projectId: string },
): Promise<void> => {
  const appliedAt = new Date().toISOString();
  await core.store.updatePlan(planId, {
    status: "applied",
    decision: "approved",
    appliedAt,
  });
  await core.store.appendPlanEvent({
    eventId: randomUUID(),
    planId,
    sessionId: context.sessionId,
    eventType: "apply_success",
    payload: {
      projectId: context.projectId,
      appliedAt,
    },
    createdAt: appliedAt,
  });
  emitPlanEvent(core, {
    eventType: "plan.applied",
    at: appliedAt,
    planId,
    sessionId: context.sessionId,
    projectId: context.projectId,
    status: "applied",
    decision: "approved",
  });
};

export const markPlanApplyFailed = async (
  core: MslCore,
  planId: string,
  context: { sessionId: string; reason: string },
): Promise<void> => {
  const plan = await core.store.getPlan(planId);
  const at = new Date().toISOString();
  await core.store.updatePlan(planId, {
    status: "apply_failed",
    decision: "blocked",
    decisionReason: context.reason,
    decidedAt: at,
  });
  await core.store.appendPlanEvent({
    eventId: randomUUID(),
    planId,
    sessionId: context.sessionId,
    eventType: "apply_failure",
    payload: {
      reason: context.reason,
      at,
    },
    createdAt: at,
  });
  emitPlanEvent(core, {
    eventType: "plan.apply_failed",
    at,
    planId,
    sessionId: context.sessionId,
    projectId: plan?.projectId ?? "",
    status: "apply_failed",
    decision: "blocked",
    reason: context.reason,
  });
};
