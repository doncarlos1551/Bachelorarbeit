import { createHash } from "node:crypto";
import type { MslCore } from "src/msl/core/core";
import type { PlanEvent, PlanRecord } from "src/msl/plan/plan.interfaces";
import type { SessionRecord } from "src/msl/session/session.interfaces";
import type { GlobalQueueSessionView } from "src/msl/core/core.interfaces";
import { OPEN_PLAN_STATUSES, isOpenPlanStatus } from "src/msl/utils";

const DEFAULT_GLOBAL_QUEUE_LIMIT = 300;

export const ensureSession = async (
  core: MslCore,
  input: {
    actorId: string;
    sessionId?: string;
    chatId?: string;
    projectId?: string;
    sessionToken?: string;
  },
): Promise<SessionRecord> => {
  // deterministische SessionID aus actorID
  let sessionId = input.sessionId;
  if (!sessionId && input.actorId && input.actorId !== "mcp-client") {
    sessionId =
      "msl_" +
      createHash("sha256").update(input.actorId).digest("hex").slice(0, 16);
  }
  return core.store.ensureSession({
    actorId: input.actorId,
    sessionId,
    sessionToken: input.sessionToken ?? core.config.sessionToken,
    chatId: input.chatId,
    projectId: input.projectId,
  });
};

export const listPlans = async (
  core: MslCore,
  input: { sessionId: string; limit?: number },
): Promise<PlanRecord[]> => {
  return core.store.listPlansBySession({
    sessionId: input.sessionId,
    limit: input.limit && input.limit > 0 ? input.limit : 50,
  });
};

export const getPlan = async (
  core: MslCore,
  planId: string,
): Promise<PlanRecord | undefined> => core.store.getPlan(planId);

export const listPlanEvents = async (
  core: MslCore,
  planId: string,
): Promise<PlanEvent[]> => core.store.listPlanEvents(planId);

export interface SessionQueueResult {
  sessionId: string;
  openPlanStatuses: PlanRecord["status"][];
  openPlans: PlanRecord[];
  historyPlans: PlanRecord[];
}

export const getSessionQueue = async (
  core: MslCore,
  input: { sessionId: string; limit?: number },
): Promise<SessionQueueResult> => {
  const plans = await listPlans(core, {
    sessionId: input.sessionId,
    limit: input.limit,
  });
  const open = plans.filter((plan) => isOpenPlanStatus(plan.status));
  const history = plans.filter((plan) => !isOpenPlanStatus(plan.status));
  open.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  return {
    sessionId: input.sessionId,
    openPlanStatuses: OPEN_PLAN_STATUSES,
    openPlans: open,
    historyPlans: history,
  };
};

export interface GlobalQueueResult {
  openPlanStatuses: PlanRecord["status"][];
  openCount: number;
  historyCount: number;
  sessions: GlobalQueueSessionView[];
  openPlans: PlanRecord[];
  historyPlans?: PlanRecord[];
}

export const getGlobalQueue = async (
  core: MslCore,
  input?: { limit?: number; includeHistory?: boolean },
): Promise<GlobalQueueResult> => {
  const limit =
    input?.limit && input.limit > 0 ? input.limit : DEFAULT_GLOBAL_QUEUE_LIMIT;
  const plans = await core.store.listPlans(limit);
  const openPlans = plans.filter((plan) => isOpenPlanStatus(plan.status));
  const historyPlans = plans.filter((plan) => !isOpenPlanStatus(plan.status));
  openPlans.sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );

  const sessionMap = new Map<string, GlobalQueueSessionView>();
  for (const plan of openPlans) {
    const current = sessionMap.get(plan.sessionId);
    if (!current) {
      sessionMap.set(plan.sessionId, {
        sessionId: plan.sessionId,
        openCount: 1,
        latestOpenAt: plan.createdAt,
        projectIds: [plan.projectId],
        openPlans: [plan],
      });
      continue;
    }
    current.openCount += 1;
    if (!current.projectIds.includes(plan.projectId)) {
      current.projectIds.push(plan.projectId);
    }
    if (!current.latestOpenAt || plan.createdAt > current.latestOpenAt) {
      current.latestOpenAt = plan.createdAt;
    }
    current.openPlans.push(plan);
  }

  const sessions = [...sessionMap.values()].sort((left, right) => {
    const leftKey = left.latestOpenAt ?? "";
    const rightKey = right.latestOpenAt ?? "";
    return rightKey.localeCompare(leftKey);
  });

  return {
    openPlanStatuses: OPEN_PLAN_STATUSES,
    openCount: openPlans.length,
    historyCount: historyPlans.length,
    sessions,
    openPlans,
    historyPlans: input?.includeHistory ? historyPlans : undefined,
  };
};
