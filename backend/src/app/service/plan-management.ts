import { PlanNotApprovedError } from "src/msl/errors";
import type { BaselineService } from "src/app/service/baseline-service";
import { resolveActorId } from "src/app/service/read-service";

export const approvePlan = async (
  service: BaselineService,
  input: {
    planId: string;
    reason?: string;
    actorId?: string;
  },
): Promise<Record<string, unknown>> => {
  const actorId = input.actorId?.trim() || resolveActorId(service);
  const updated = await service.msl.approvePlan({
    planId: input.planId,
    actorId,
    reason: input.reason,
  });

  let applied = true;
  let applyError: string | undefined;
  try {
    await applyPlan(service, { planId: input.planId });
  } catch (error) {
    if (error instanceof PlanNotApprovedError) {
      // Wait-Loop bereits applied -> no-op
    } else {
      applied = false;
      applyError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    mode: "baseline_direct_apply",
    planId: input.planId,
    decision: "approved",
    applied,
    ...(applyError ? { applyError } : {}),
    plan: updated,
  };
};

export const cleanupOpenPlans = async (
  service: BaselineService,
  input: {
    scope: "all" | "session";
    sessionId?: string;
    reason?: string;
  },
): Promise<{ rejectedCount: number }> => {
  const actorId = resolveActorId(service);
  const rejectedCount = await service.msl.cleanupOpenPlans({
    scope: input.scope,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    reason: input.reason ?? "Auto-cleanup at session/case boundary",
    actorId,
  });
  return { rejectedCount };
};

export const rejectPlan = async (
  service: BaselineService,
  input: {
    planId: string;
    reason?: string;
    actorId?: string;
  },
): Promise<Record<string, unknown>> => {
  const actorId = input.actorId?.trim() || resolveActorId(service);
  const updated = await service.msl.rejectPlan({
    planId: input.planId,
    actorId,
    reason: input.reason,
  });
  return {
    mode: "baseline_direct_apply",
    planId: input.planId,
    decision: "rejected",
    plan: updated,
  };
};

// Admin-Endpoint /admin/plans/:id/apply und Auto-Apply nach Approve
export const applyPlan = async (
  service: BaselineService,
  input: { planId: string },
): Promise<Record<string, unknown>> => {
  const preparedPlan = await service.msl.getPlan(input.planId);
  if (!preparedPlan) {
    throw new Error(`Plan '${input.planId}' not found.`);
  }

  const loaded = await service.client.getApplication(preparedPlan.projectId);
  service.context.set({
    projectId: preparedPlan.projectId,
    actorId: resolveActorId(service),
    sessionId: preparedPlan.sessionId,
    chatId: preparedPlan.chatId,
  });

  const prepared = await service.msl.preparePlanApply({
    planId: input.planId,
    baselineDsl: loaded.applicationDsl,
  });

  await service.applyExecutor.run({
    loaded,
    nextDsl: prepared.nextDsl,
    context: {
      planId: input.planId,
      sessionId: prepared.plan.sessionId,
      projectId: prepared.plan.projectId,
    },
    mode: "msl_guarded_apply",
  });

  return {
    mode: "msl_guarded_apply",
    project: loaded.project,
    session: {
      sessionId: prepared.plan.sessionId,
      chatId: prepared.plan.chatId,
    },
    operationCount: prepared.plan.operations.length,
    applied: true,
    steps: prepared.steps,
    summary: prepared.summary,
    msl: {
      enabled: true,
      decision: "approved",
      planId: prepared.plan.planId,
      sessionId: prepared.plan.sessionId,
    },
  };
};

export const listPlans = async (
  service: BaselineService,
  input?: {
    sessionId?: string;
    limit?: number;
  },
): Promise<Record<string, unknown>> => {
  let sessionId = input?.sessionId?.trim() || service.context.get().sessionId;
  if (!sessionId) {
    const actorId = resolveActorId(service);
    const session = await service.msl.ensureSession({
      actorId,
      sessionId: service.context.get().sessionId,
      chatId: service.context.get().chatId,
      projectId: service.context.get().projectId,
    });
    service.context.set({
      actorId,
      projectId: service.context.get().projectId,
      sessionId: session.sessionId,
      chatId: session.chatId,
    });
    sessionId = session.sessionId;
  }
  const plans = await service.msl.listPlans({
    sessionId,
    limit: input?.limit,
  });
  return {
    mode: "baseline_direct_apply",
    sessionId,
    count: plans.length,
    plans,
  };
};

export const getPlan = async (
  service: BaselineService,
  planId: string,
): Promise<Record<string, unknown>> => {
  const plan = await service.msl.getPlan(planId);
  return {
    mode: "baseline_direct_apply",
    planId,
    found: Boolean(plan),
    plan,
  };
};

export const listPlanEvents = async (
  service: BaselineService,
  planId: string,
): Promise<Record<string, unknown>> => {
  const events = await service.msl.listPlanEvents(planId);
  return {
    mode: "baseline_direct_apply",
    planId,
    count: events.length,
    events,
  };
};
