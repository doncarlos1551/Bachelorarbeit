import type { MslRuntimeConfigPatch } from "src/msl/core";
import { publishBackplaneEvent } from "src/app/backplane-events";
import type { BaselineService } from "src/app/service/baseline-service";
import { resolveActorId } from "src/app/service/read-service";

export const getBackplaneConfig = async (
  service: BaselineService,
): Promise<Record<string, unknown>> => ({
  mode: "baseline_direct_apply",
  msl: service.msl.getRuntimeInfo(),
});

export const updateBackplaneConfig = async (
  service: BaselineService,
  input: {
    patch: MslRuntimeConfigPatch;
    actorId?: string;
  },
): Promise<Record<string, unknown>> => {
  const actorId = input.actorId?.trim() || resolveActorId(service);
  const updated = await service.msl.updateRuntimeConfig({
    patch: input.patch,
    updatedBy: actorId,
  });
  publishBackplaneEvent({
    eventType: "admin.config_updated",
    payload: {
      actorId,
      updated,
    },
  });
  return {
    mode: "baseline_direct_apply",
    ...updated,
  };
};

export const getSessionQueue = async (
  service: BaselineService,
  input: {
    sessionId: string;
    limit?: number;
  },
): Promise<Record<string, unknown>> => {
  const queue = await service.msl.getSessionQueue(input);
  return {
    mode: "baseline_direct_apply",
    sessionId: queue.sessionId,
    openCount: queue.openPlans.length,
    historyCount: queue.historyPlans.length,
    openPlanStatuses: queue.openPlanStatuses,
    openPlans: queue.openPlans,
    historyPlans: queue.historyPlans,
  };
};

export const getGlobalQueue = async (
  service: BaselineService,
  input?: {
    limit?: number;
    includeHistory?: boolean;
  },
): Promise<Record<string, unknown>> => {
  const queue = await service.msl.getGlobalQueue(input);
  return {
    mode: "baseline_direct_apply",
    ...queue,
  };
};
