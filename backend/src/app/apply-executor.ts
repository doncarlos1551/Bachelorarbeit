import type {
  LoadedApplication,
  LowcoderClient,
} from "src/adapters/lowcoder/client";
import type { MslCore } from "src/msl/core";
import type { JsonRecord } from "src/shared/utils";
import type { DslCache } from "src/app/dsl-cache";
import { emitToolCompleted } from "src/app/tool-lifecycle-events";

// === Apply Executor ===
// Schreibt die berechnete next-DSL in die Lowcoder-editing-DSL (Shadow), aktualisiert

export interface ApplyContext {
  planId: string;
  sessionId: string;
  projectId: string;
  toolCallId?: string;
}

export interface ApplyInvocation {
  loaded: LoadedApplication;
  nextDsl: JsonRecord;
  context: ApplyContext;
  mode: "msl_guarded_apply" | "msl_manual_plan";
}

export class ApplyExecutor {
  constructor(
    private readonly client: LowcoderClient,
    private readonly msl: MslCore,
    private readonly dslCache: DslCache,
  ) {}

  async run(invocation: ApplyInvocation): Promise<void> {
    const { loaded, nextDsl, context, mode } = invocation;
    try {
      await this.client.saveApplication(loaded, nextDsl);
      this.dslCache.set(context.projectId, nextDsl);
      await this.msl.markPlanApplied(context.planId, {
        sessionId: context.sessionId,
        projectId: context.projectId,
      });
      if (context.toolCallId) {
        emitToolCompleted({
          sessionId: context.sessionId,
          planId: context.planId,
          projectId: context.projectId,
          toolCallId: context.toolCallId,
          mode,
          applied: true,
        });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.msl.markPlanApplyFailed(context.planId, {
        sessionId: context.sessionId,
        reason,
      });
      throw new Error(
        `Lowcoder apply failed [planId=${context.planId}]: ${reason}`,
      );
    }
  }
}
