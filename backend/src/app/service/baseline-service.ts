import { WorkspaceContextStore } from "src/app/context-store";
import type { WorkspaceContext } from "src/app/context-store.interfaces";
import { LowcoderClient } from "src/adapters/lowcoder/client";
import { LowcoderMslAdapter } from "src/adapters/lowcoder/msl-adapter";
import {
  MslCore,
  type MslPlanLifecycleEvent,
  type MslRuntimeConfigPatch,
} from "src/msl/core";
import { publishBackplaneEvent } from "src/app/backplane-events";
import { DslCache } from "src/app/dsl-cache";
import { ApplyExecutor } from "src/app/apply-executor";
import { ApprovalCoordinator } from "src/app/approval-coordinator";
import type { ApplyOperationsInput } from "src/app/service/baseline-service.interfaces";
import * as readService from "src/app/service/read-service";
import * as applyPipeline from "src/app/service/apply-pipeline";
import * as planManagement from "src/app/service/plan-management";
import * as configService from "src/app/service/config-service";

export type { ApplyOperationsInput } from "src/app/service/baseline-service.interfaces";

export class BaselineService {
  // public-readonly damit Module in service/apply-pipeline, service/plan-management,service/read-service, service/config-service auf den State zugreifen können
  readonly context: WorkspaceContextStore;
  readonly client: LowcoderClient;
  readonly msl: MslCore;
  readonly dslCache: DslCache;
  readonly applyExecutor: ApplyExecutor;
  readonly approvalCoordinator: ApprovalCoordinator;
  readonly projectLocks = new Map<string, Promise<unknown>>();

  constructor() {
    this.client = LowcoderClient.fromEnv();
    this.msl = new MslCore({
      adapter: new LowcoderMslAdapter(),
      onPlanEvent: (event) => this.handlePlanLifecycleEvent(event),
    });
    this.context = new WorkspaceContextStore(
      process.env.DEFAULT_ACTOR_ID ?? "mcp-client",
    );
    this.dslCache = new DslCache();
    this.applyExecutor = new ApplyExecutor(
      this.client,
      this.msl,
      this.dslCache,
    );
    this.approvalCoordinator = new ApprovalCoordinator(this.msl);
  }

  // === Read & Workspace ===

  getWorkspaceContext(): WorkspaceContext {
    return readService.getWorkspaceContext(this);
  }

  setWorkspaceContext(input: {
    projectId?: string;
    actorId?: string;
    sessionId?: string;
    chatId?: string;
  }): WorkspaceContext {
    return readService.setWorkspaceContext(this, input);
  }

  async listProjects(
    limit: number,
    search?: string,
  ): Promise<Record<string, unknown>> {
    return readService.listProjects(this, limit, search);
  }

  async createProject(projectName: string): Promise<Record<string, unknown>> {
    return readService.createProject(this, projectName);
  }

  async projectSummary(projectId?: string): Promise<Record<string, unknown>> {
    return readService.projectSummary(this, projectId);
  }

  async listComponents(
    projectId?: string,
    limit = 200,
  ): Promise<Record<string, unknown>> {
    return readService.listComponents(this, projectId, limit);
  }

  async inspectDsl(
    projectId?: string,
    options?: { componentId?: string; includeRawDsl?: boolean },
  ): Promise<Record<string, unknown>> {
    return readService.inspectDsl(this, projectId, options);
  }

  // === Apply ===

  async applyOperations(
    input: ApplyOperationsInput,
  ): Promise<Record<string, unknown>> {
    return applyPipeline.applyOperations(this, input);
  }

  // === Plan-Management ===

  async approvePlan(input: {
    planId: string;
    reason?: string;
    actorId?: string;
  }): Promise<Record<string, unknown>> {
    return planManagement.approvePlan(this, input);
  }

  async rejectPlan(input: {
    planId: string;
    reason?: string;
    actorId?: string;
  }): Promise<Record<string, unknown>> {
    return planManagement.rejectPlan(this, input);
  }

  async applyPlan(input: { planId: string }): Promise<Record<string, unknown>> {
    return planManagement.applyPlan(this, input);
  }

  async cleanupOpenPlans(input: {
    scope: "all" | "session";
    sessionId?: string;
    reason?: string;
  }): Promise<{ rejectedCount: number }> {
    return planManagement.cleanupOpenPlans(this, input);
  }

  async listPlans(input?: {
    sessionId?: string;
    limit?: number;
  }): Promise<Record<string, unknown>> {
    return planManagement.listPlans(this, input);
  }

  async getPlan(planId: string): Promise<Record<string, unknown>> {
    return planManagement.getPlan(this, planId);
  }

  async listPlanEvents(planId: string): Promise<Record<string, unknown>> {
    return planManagement.listPlanEvents(this, planId);
  }

  // === Config & Queue ===

  async getBackplaneConfig(): Promise<Record<string, unknown>> {
    return configService.getBackplaneConfig(this);
  }

  async getSessionQueue(input: {
    sessionId: string;
    limit?: number;
  }): Promise<Record<string, unknown>> {
    return configService.getSessionQueue(this, input);
  }

  async getGlobalQueue(input?: {
    limit?: number;
    includeHistory?: boolean;
  }): Promise<Record<string, unknown>> {
    return configService.getGlobalQueue(this, input);
  }

  async updateBackplaneConfig(input: {
    patch: MslRuntimeConfigPatch;
    actorId?: string;
  }): Promise<Record<string, unknown>> {
    return configService.updateBackplaneConfig(this, input);
  }

  // PlanLifecycleEvents vom MslCore werden über BackplaneBus weitergeleitet damit SSE-Subscribers (Frontend) es sieht
  private handlePlanLifecycleEvent(event: MslPlanLifecycleEvent): void {
    publishBackplaneEvent({
      eventType: event.eventType,
      at: event.at,
      planId: event.planId,
      sessionId: event.sessionId,
      projectId: event.projectId,
      payload: {
        status: event.status,
        decision: event.decision,
        reason: event.reason,
        ...event.payload,
      },
    });
  }
}
