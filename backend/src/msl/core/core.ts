import path from "node:path";
import type { MslAdapter } from "src/msl/adapter/adapter.interfaces";
import type { PlanRecord } from "src/msl/plan/plan.interfaces";
import type { SessionRecord } from "src/msl/session/session.interfaces";
import type { MslStore } from "src/msl/store/store.interfaces";
import type { BaselineOperation } from "src/app/operations";
import type { JsonRecord } from "src/shared/utils";
import { createMslStore } from "src/msl/store/store";
import {
  type MslConfig,
  type MslRuntimeConfigPatch,
  readConfigFromEnv,
} from "src/msl/config";
import * as queue from "src/msl/core/queue";
import * as runtimeConfig from "src/msl/core/runtime-config";
import * as planLifecycle from "src/msl/core/plan-lifecycle";
import { runProcessPipeline } from "src/msl/core/pipeline";
import type {
  MslCoreOptions,
  MslPlanLifecycleEvent,
  ProcessInput,
  ProcessResult,
} from "src/msl/core/core.interfaces";
export type {
  MslPlanLifecycleEvent,
  ProcessInput,
  ProcessResult,
} from "src/msl/core/core.interfaces";
export type { MslRuntimeConfigPatch } from "src/msl/config";
export { scanOperationsForDangerousContent } from "src/msl/content-scanner";

export class MslCore {
  // public-readonly damit Modul-Funktionen in core/queue.ts, core/plan-lifecycle.ts,
  // core/pipeline.ts, core/runtime-config.ts auf den State zugreifen können
  // ohne dass Klassen-Methoden mit jeder Änderung mit-extrahiert werden müssten
  readonly config: MslConfig;
  readonly store: MslStore;
  readonly adapter: MslAdapter<BaselineOperation, JsonRecord>;
  readonly onPlanEvent?: (event: MslPlanLifecycleEvent) => void;
  readonly runtimeConfigPath: string;
  runtimeConfigUpdatedAt?: string;
  runtimeConfigUpdatedBy?: string;

  constructor(options: MslCoreOptions) {
    this.adapter = options.adapter;
    this.config = options.config ?? readConfigFromEnv();
    this.store = options.store ?? createMslStore();
    this.onPlanEvent = options.onPlanEvent;
    this.runtimeConfigPath = path.join(
      this.config.dataDir,
      "runtime-config.json",
    );
    runtimeConfig.loadRuntimeConfigFromDisk(this);
  }

  async ensureSession(input: {
    actorId: string;
    sessionId?: string;
    chatId?: string;
    projectId?: string;
    sessionToken?: string;
  }): Promise<SessionRecord> {
    return queue.ensureSession(this, input);
  }

  async listPlans(input: {
    sessionId: string;
    limit?: number;
  }): Promise<PlanRecord[]> {
    return queue.listPlans(this, input);
  }

  async getPlan(planId: string): Promise<PlanRecord | undefined> {
    return queue.getPlan(this, planId);
  }

  async listPlanEvents(planId: string) {
    return queue.listPlanEvents(this, planId);
  }

  isManualExecutionMode(): boolean {
    return this.config.executionMode === "manual";
  }

  getRuntimeInfo(): Record<string, unknown> {
    return runtimeConfig.getRuntimeInfo(this);
  }

  async updateRuntimeConfig(input: {
    patch: MslRuntimeConfigPatch;
    updatedBy?: string;
  }): Promise<Record<string, unknown>> {
    return runtimeConfig.updateRuntimeConfig(this, input);
  }

  async getSessionQueue(input: { sessionId: string; limit?: number }) {
    return queue.getSessionQueue(this, input);
  }

  async getGlobalQueue(input?: { limit?: number; includeHistory?: boolean }) {
    return queue.getGlobalQueue(this, input);
  }

  async approvePlan(input: {
    planId: string;
    actorId: string;
    reason?: string;
  }): Promise<PlanRecord> {
    return planLifecycle.approvePlan(this, input);
  }

  async rejectPlan(input: {
    planId: string;
    actorId: string;
    reason?: string;
  }): Promise<PlanRecord> {
    return planLifecycle.rejectPlan(this, input);
  }

  async cleanupOpenPlans(input: {
    scope: "all" | "session";
    sessionId?: string;
    reason: string;
    actorId: string;
  }): Promise<number> {
    return planLifecycle.cleanupOpenPlans(this, input);
  }

  async preparePlanApply(input: {
    planId: string;
    baselineDsl: JsonRecord;
  }): Promise<{
    plan: PlanRecord;
    nextDsl: JsonRecord;
    steps: Array<Record<string, unknown>>;
    summary: Record<string, unknown>;
  }> {
    return planLifecycle.preparePlanApply(this, input);
  }

  async markPlanApplied(
    planId: string,
    context: { sessionId: string; projectId: string },
  ): Promise<void> {
    return planLifecycle.markPlanApplied(this, planId, context);
  }

  async markPlanApplyFailed(
    planId: string,
    context: { sessionId: string; reason: string },
  ): Promise<void> {
    return planLifecycle.markPlanApplyFailed(this, planId, context);
  }

  // === MSL-Pipeline ===
  // process delegiert an runProcessPipeline (core/pipeline.ts) mit allen Stufen
  async process(input: ProcessInput): Promise<ProcessResult> {
    return runProcessPipeline(this, input);
  }
}
