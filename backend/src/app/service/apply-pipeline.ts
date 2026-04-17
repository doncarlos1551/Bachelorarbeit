import { randomUUID } from "node:crypto";
import type { LoadedApplication } from "src/adapters/lowcoder/client";
import { MslRejectionError, PlanNotApprovedError } from "src/msl/errors";
import { summarizeApplicationDsl } from "src/adapters/lowcoder/dsl";
import type { ProcessResult } from "src/msl/core";
import type { SessionRecord } from "src/msl/session/session.interfaces";
import type { ApplyOperationsInput } from "src/app/service/baseline-service.interfaces";
import type { BaselineService } from "src/app/service/baseline-service";
import {
  emitApprovalPending,
  emitToolCompleted,
  emitToolFailed,
  emitToolReceived,
} from "src/app/tool-lifecycle-events";
import { resolveActorId, resolveProjectId } from "src/app/service/read-service";
import { applyPlan } from "src/app/service/plan-management";

export const applyOperations = async (
  service: BaselineService,
  input: ApplyOperationsInput,
): Promise<Record<string, unknown>> => {
  // bei reinen Schema-Fehlern kann operations leer sein
  // schemaIssues sammeln aber wenigtens eines muss da sein
  const hasSchemaIssues = (input.schemaIssues?.length ?? 0) > 0;
  if (input.operations.length === 0 && !hasSchemaIssues) {
    throw new Error("operations must not be empty");
  }
  const resolvedProjectId = resolveProjectId(service, input.projectId);
  return withProjectLock(service, resolvedProjectId, () =>
    runApplyPipeline(service, input, resolvedProjectId),
  );
};

// Mutex(async) pro Projekt damit zwei parallele applyOperations sich nicht überschreiben
const withProjectLock = async <T>(
  service: BaselineService,
  projectId: string,
  operation: () => Promise<T>,
): Promise<T> => {
  const previous = service.projectLocks.get(projectId) ?? Promise.resolve();
  const current = previous.then(operation, operation);
  service.projectLocks.set(projectId, current);
  try {
    return await current;
  } finally {
    if (service.projectLocks.get(projectId) === current) {
      service.projectLocks.delete(projectId);
    }
  }
};

const runApplyPipeline = async (
  service: BaselineService,
  input: ApplyOperationsInput,
  resolvedProjectId: string,
): Promise<Record<string, unknown>> => {
  const loaded = await loadBaselineWithCache(service, resolvedProjectId);
  const actorId = resolveActorId(service);
  const session = await service.msl.ensureSession({
    actorId,
    sessionId: input.sessionId ?? service.context.get().sessionId,
    chatId: input.chatId ?? service.context.get().chatId,
    projectId: resolvedProjectId,
  });
  service.context.set({
    projectId: resolvedProjectId,
    actorId,
    sessionId: session.sessionId,
    chatId: session.chatId,
  });

  const toolCallId = randomUUID();
  const resolvedUserComment = resolveUserComment(input);
  emitToolReceived({
    sessionId: session.sessionId,
    projectId: resolvedProjectId,
    toolCallId,
    actorId,
    chatId: session.chatId,
    operations: input.operations,
    userComment: resolvedUserComment,
  });

  try {
    const guardedResult = await service.msl.process({
      projectId: resolvedProjectId,
      actorId,
      sessionId: session.sessionId,
      chatId: session.chatId,
      userComment: resolvedUserComment,
      operations: input.operations,
      baselineDsl: loaded.applicationDsl,
      ...(input.mcpCall ? { mcpCall: input.mcpCall } : {}),
      ...(input.schemaIssues ? { schemaIssues: input.schemaIssues } : {}),
      ...(input.operationIndexes
        ? { operationIndexes: input.operationIndexes }
        : {}),
    });

    const needsUserApproval =
      guardedResult.mode === "msl_manual_plan" &&
      guardedResult.msl.decision === "not_evaluated" &&
      guardedResult.msl.planId !== undefined;

    if (needsUserApproval) {
      return await handleManualApproval(service, {
        guardedResult,
        loaded,
        session,
        resolvedProjectId,
        actorId,
        toolCallId,
        resolvedUserComment,
        operationCount: input.operations.length,
      });
    }

    return await handleDirectApply(service, {
      guardedResult,
      loaded,
      session,
      resolvedProjectId,
      toolCallId,
      resolvedUserComment,
      operationCount: input.operations.length,
    });
  } catch (error) {
    emitToolFailed({
      sessionId: session.sessionId,
      projectId: resolvedProjectId,
      toolCallId,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

// === Direct-Apply (auto-Mode oder MSL deaktiviert) ===
const handleDirectApply = async (
  service: BaselineService,
  input: {
    guardedResult: ProcessResult;
    loaded: LoadedApplication;
    session: SessionRecord;
    resolvedProjectId: string;
    toolCallId: string;
    resolvedUserComment: string | undefined;
    operationCount: number;
  },
): Promise<Record<string, unknown>> => {
  const { guardedResult, loaded, session, resolvedProjectId, toolCallId } =
    input;
  if (guardedResult.msl.planId) {
    await service.applyExecutor.run({
      loaded,
      nextDsl: guardedResult.nextDsl,
      context: {
        planId: guardedResult.msl.planId,
        sessionId: session.sessionId,
        projectId: resolvedProjectId,
        toolCallId,
      },
      mode:
        guardedResult.mode === "msl_manual_plan"
          ? "msl_manual_plan"
          : "msl_guarded_apply",
    });
  } else {
    await service.client.saveApplication(loaded, guardedResult.nextDsl);
    service.dslCache.set(resolvedProjectId, guardedResult.nextDsl);
    emitToolCompleted({
      sessionId: session.sessionId,
      projectId: resolvedProjectId,
      toolCallId,
      mode: guardedResult.mode,
      applied: true,
    });
  }
  return buildAppliedResult({
    guardedResult,
    loaded,
    session,
    operationCount: input.operationCount,
    resolvedUserComment: input.resolvedUserComment,
    decisionOverride: undefined,
  });
};

// === Manual-Approval (manual-Mode und Plan in preflighted Status) ===
// - tool.approval_pending für Frontend-Polling
// - ApprovalCoordinator pollt bis approved|rejected|timeout
// - applied  -> Race-Win dann anderer Pfad hat schon -> kein eigener Apply
const handleManualApproval = async (
  service: BaselineService,
  input: {
    guardedResult: ProcessResult;
    loaded: LoadedApplication;
    session: SessionRecord;
    resolvedProjectId: string;
    actorId: string;
    toolCallId: string;
    resolvedUserComment: string | undefined;
    operationCount: number;
  },
): Promise<Record<string, unknown>> => {
  const {
    guardedResult,
    loaded,
    session,
    resolvedProjectId,
    actorId,
    toolCallId,
  } = input;
  const planId = guardedResult.msl.planId;
  if (!planId) {
    throw new Error("Manual-Approval ohne planId nicht möglich.");
  }

  emitApprovalPending({
    sessionId: session.sessionId,
    planId,
    projectId: resolvedProjectId,
    toolCallId,
    mode: guardedResult.mode,
    riskLevel: guardedResult.msl.risk?.level,
  });

  const decision = await service.approvalCoordinator.awaitDecision(planId);

  if (decision === "approved") {
    try {
      await applyPlan(service, { planId });
    } catch (error) {
      // Race-Condition: parallel hat approve-API bereits applied
      // preparePlanApply wirft dann PlanNotApprovedError -> wird als erfolg verarbeitet
      if (!(error instanceof PlanNotApprovedError)) {
        emitToolCompleted({
          sessionId: session.sessionId,
          planId,
          projectId: resolvedProjectId,
          toolCallId,
          mode: guardedResult.mode,
          applied: false,
          decision: "apply_failed",
        });
        throw error;
      }
    }
  }

  if (decision === "approved" || decision === "applied") {
    emitToolCompleted({
      sessionId: session.sessionId,
      planId,
      projectId: resolvedProjectId,
      toolCallId,
      mode: guardedResult.mode,
      applied: true,
      decision: "approved",
    });
    return buildAppliedResult({
      guardedResult,
      loaded,
      session,
      operationCount: input.operationCount,
      resolvedUserComment: input.resolvedUserComment,
      decisionOverride: "approved",
    });
  }

  if (decision === "timeout") {
    try {
      await service.msl.rejectPlan({
        planId,
        actorId,
        reason: "Approval-Timeout (120s ohne Nutzer-Entscheidung)",
      });
    } catch {
      // Plan möglicherweise schon final deshab ignorieren
    }
  }
  emitToolCompleted({
    sessionId: session.sessionId,
    planId,
    projectId: resolvedProjectId,
    toolCallId,
    mode: guardedResult.mode,
    applied: false,
    decision,
  });
  const reason =
    decision === "rejected"
      ? "Plan wurde vom Nutzer abgelehnt. Die Änderung wurde NICHT angewendet."
      : "Plan-Freigabe hat das Zeitlimit überschritten und wurde automatisch abgelehnt. Die Änderung wurde NICHT angewendet.";
  throw new MslRejectionError(reason, {
    planId,
    mslPayload: { ...guardedResult.msl, decision: "rejected" },
  });
};

const loadBaselineWithCache = async (
  service: BaselineService,
  projectId: string,
): Promise<LoadedApplication> => {
  const loaded = await service.client.getApplication(projectId);
  const cachedDsl = service.dslCache.get(projectId);
  if (cachedDsl) {
    loaded.applicationDsl = cachedDsl;
  }
  return loaded;
};

const buildAppliedResult = (input: {
  guardedResult: ProcessResult;
  loaded: LoadedApplication;
  session: SessionRecord;
  operationCount: number;
  resolvedUserComment: string | undefined;
  decisionOverride: "approved" | undefined;
}): Record<string, unknown> => {
  const { guardedResult, loaded, session, decisionOverride } = input;
  const summary =
    guardedResult.summary ?? summarizeApplicationDsl(guardedResult.nextDsl);
  return {
    mode: guardedResult.mode,
    project: loaded.project,
    session: {
      sessionId: session.sessionId,
      chatId: session.chatId,
    },
    operationCount: input.operationCount,
    userComment: input.resolvedUserComment,
    applied: true,
    steps: guardedResult.steps,
    summary,
    msl: decisionOverride
      ? { ...guardedResult.msl, decision: decisionOverride }
      : guardedResult.msl,
  };
};

const resolveUserComment = (
  input: ApplyOperationsInput,
): string | undefined => {
  if (input.userComment) return input.userComment;
  for (const operation of input.operations) {
    if (
      typeof operation.userComment === "string" &&
      operation.userComment.trim().length > 0
    ) {
      return operation.userComment;
    }
  }
  return undefined;
};
