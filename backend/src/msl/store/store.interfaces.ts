import type {
  EnsureSessionInput,
  SessionRecord,
} from "src/msl/session/session.interfaces";
import type {
  PlanEvent,
  PlanListFilter,
  PlanRecord,
  PlanUpdate,
} from "src/msl/plan/plan.interfaces";
import type {
  ProjectLockRequest,
  ProjectLockResult,
} from "src/msl/lock/lock.interfaces";

export interface MslStore {
  ensureSession(input: EnsureSessionInput): Promise<SessionRecord>;
  createPlan(record: PlanRecord): Promise<void>;
  appendPlanEvent(event: PlanEvent): Promise<void>;
  updatePlan(planId: string, update: PlanUpdate): Promise<void>;
  getPlan(planId: string): Promise<PlanRecord | undefined>;
  listPlansBySession(filter: PlanListFilter): Promise<PlanRecord[]>;
  listPlans(limit: number): Promise<PlanRecord[]>;
  listPlanEvents(planId: string): Promise<PlanEvent[]>;
  tryAcquireProjectLock(
    request: ProjectLockRequest,
  ): Promise<ProjectLockResult>;
}
