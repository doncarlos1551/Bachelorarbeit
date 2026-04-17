import { randomUUID } from "node:crypto";
import type {
  GateEvaluation,
  PolicyResult,
  ValidationResult,
} from "src/msl/gates/gates.interfaces";
import { isInfeasibleVerdict } from "src/msl/gates/gates.interfaces";
import type { PreflightResult } from "src/msl/gates/shared.interfaces";
import type { PlanRecord } from "src/msl/plan/plan.interfaces";
import type { SessionRecord } from "src/msl/session/session.interfaces";
import type { MslPayload } from "src/msl/payload/payload.interfaces";
import type { DiffResult } from "src/msl/payload/diff.interfaces";
import {
  buildApprovalReasoning,
  buildApprovalReasoningStructured,
  buildGateResult,
  computeOpVerdicts,
  elevateRiskForImpacts,
  elevateRiskForLockConflict,
  evaluateGenericValidation,
  evaluatePolicy,
  evaluatePreflight,
  evaluateRisk,
  formatInfeasibleVerdicts,
  mergeValidation,
  partitionVerdictErrors,
  renderWarningsForWire,
} from "src/msl/gates/index";
import { scanOperationsForDangerousContent } from "src/msl/content-scanner";
import { MslRejectionError } from "src/msl/errors";
import { hashObject, isOpenPlanStatus } from "src/msl/utils";
import { writeAuditEvent } from "src/msl/audit/audit";
import type {
  PreSnapshotResult,
  ProcessInput,
  ProcessResult,
} from "src/msl/core/core.interfaces";
import type { MslCore } from "src/msl/core/core";
import { ensureSession } from "src/msl/core/queue";
import { emitPlanEvent } from "src/msl/core/plan-lifecycle";

// === Pipeline-Eintrittspunkt ===

export const runProcessPipeline = async (
  core: MslCore,
  input: ProcessInput,
): Promise<ProcessResult> => {
  const session = await ensureSession(core, {
    actorId: input.actorId,
    sessionId: input.sessionId,
    chatId: input.chatId,
    projectId: input.projectId,
  });

  if (!core.config.enabled) {
    const preflightDisabled = core.adapter.preflight({
      baselineSnapshot: input.baselineDsl,
      operations: input.operations,
    });
    return {
      mode: "baseline_direct_apply",
      nextDsl: preflightDisabled.nextSnapshot,
      steps: preflightDisabled.steps,
      summary: preflightDisabled.summary,
      msl: {
        enabled: false,
        decision: "not_evaluated",
        sessionId: session.sessionId,
      },
    };
  }

  // === Stufe 1: Pre-Snapshot-Prüfung ===
  const pre = await runPreSnapshotStage(core, input, session);

  // === Stufe 2: Fail-Fast-Ausstieg (Drei-Gate-Block und Schema-Fehler) ===
  const policyBlocks =
    !pre.policy.passed && core.config.gateModes.policy === "enforce";
  const preflightBlocks =
    !pre.preflightGate.passed && core.config.gateModes.preflight === "enforce";
  const validationBlocks =
    !pre.genericValidation.passed &&
    core.config.gateModes.validation === "enforce";
  const schemaIssues = input.schemaIssues ?? [];
  const hasSchemaFailure = schemaIssues.length > 0;

  if (policyBlocks || preflightBlocks || validationBlocks || hasSchemaFailure) {
    const consolidatedVerdictText = formatInfeasibleVerdicts(
      pre.opVerdicts,
      schemaIssues,
    );
    // Per-Op-Errors sind schon im consolidatedVerdictText, daher nur Batch-Level-Errors anhängen
    const isPerOpError = (raw: string): boolean => raw.startsWith("[op #");
    const reasonParts: string[] = [];
    if (policyBlocks) {
      reasonParts.push(
        ...pre.policy.violations.filter(
          (violation) => !isPerOpError(violation),
        ),
      );
    }
    if (preflightBlocks) {
      reasonParts.push(
        ...pre.preflightGate.violations.filter(
          (violation) => !isPerOpError(violation),
        ),
      );
    }
    if (validationBlocks) {
      reasonParts.push(
        ...pre.genericValidation.errors.filter(
          (validationError) => !isPerOpError(validationError),
        ),
      );
    }
    const reason =
      consolidatedVerdictText && reasonParts.length > 0
        ? `${consolidatedVerdictText}\n${reasonParts.join(" ")}`.trim()
        : consolidatedVerdictText || reasonParts.join(" ");
    const { planId, mslPayload } = await assembleBlockedPlan(core, {
      input,
      session,
      pre,
      validation: pre.genericValidation,
      reason,
      diffSummary: "Nicht ausgewertet (Pre-Snapshot-Gate hat hart blockiert).",
      preflightExtras: {
        preflightRateLimit: pre.preflightGate.details?.rateLimit,
        missingEntityRefs: pre.preflightGate.details?.missingEntityRefs,
        selfContradictions: pre.preflightGate.details?.selfContradictions,
        expressionIssues: pre.preflightGate.details?.expressionIssues,
        ...(hasSchemaFailure ? { schemaIssues } : {}),
      },
      decisionExtras: hasSchemaFailure ? { schemaIssues } : undefined,
      createdExtras: hasSchemaFailure
        ? { schemaIssueCount: schemaIssues.length }
        : undefined,
      auditExtras: {
        preflightRateLimit: pre.preflightGate.details?.rateLimit,
        ...(hasSchemaFailure ? { schemaIssues } : {}),
      },
    });
    throw new MslRejectionError(reason, { planId, mslPayload });
  }

  // === Stufe 3: Snapshot-Erzeugung ===
  let preflight: ReturnType<typeof core.adapter.preflight>;
  try {
    preflight = core.adapter.preflight({
      baselineSnapshot: input.baselineDsl,
      operations: input.operations,
    });
  } catch (error) {
    const adapterMessage =
      error instanceof Error ? error.message : String(error);
    const reason = `Adapter konnte Snapshot nicht berechnen: ${adapterMessage}`;
    const adapterFailureValidation: ValidationResult = {
      passed: false,
      errors: [reason],
      warnings: pre.genericValidation.warnings,
    };
    const { planId, mslPayload } = await assembleBlockedPlan(core, {
      input,
      session,
      pre,
      validation: adapterFailureValidation,
      reason,
      diffSummary: "Nicht ausgewertet (Adapter-Snapshot fehlgeschlagen).",
      preflightExtras: { adapterFailure: true },
      decisionExtras: { adapterFailure: true },
      createdExtras: { adapterFailure: true },
      auditExtras: { adapterFailure: true },
    });
    throw new MslRejectionError(reason, { planId, mslPayload });
  }

  // === Stufe 4: Post-Snapshot-Analyse (Map-Reduce-Validierung, diff, risk) ===
  const planId = `plan_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const candidateHash = hashObject(preflight.nextSnapshot);
  const validator = core.adapter.beginValidation({
    baselineSnapshot: input.baselineDsl,
    candidateSnapshot: preflight.nextSnapshot,
    operations: input.operations,
  });
  const perOpErrors: string[] = [];
  const perOpWarnings: ValidationResult["warnings"] = [];
  input.operations.forEach((operation, position) => {
    const opIndex = input.operationIndexes?.[position] ?? position;
    const result = validator.validateOperation({ operation, opIndex });
    perOpErrors.push(...result.errors);
    perOpWarnings.push(...result.warnings);
  });
  const batchOutcome = validator.finalize();
  const adapterValidation: ValidationResult = {
    passed: perOpErrors.length === 0 && batchOutcome.errors.length === 0,
    errors: [...perOpErrors, ...batchOutcome.errors],
    warnings: [...perOpWarnings, ...batchOutcome.warnings],
  };
  const validation = mergeValidation(pre.genericValidation, adapterValidation);
  const diff = core.adapter.diff({
    baselineSnapshot: input.baselineDsl,
    candidateSnapshot: preflight.nextSnapshot,
    operations: input.operations,
  });
  const risk = elevateRiskForImpacts(
    elevateRiskForLockConflict(
      evaluateRisk(
        input.operations,
        core.config.approvalRiskThreshold,
        pre.contentScanResults,
      ),
      pre.lockViolation,
    ),
    batchOutcome.impacts,
  );

  // === Stufe 5: Entscheidung (Gate-Aggregation) ===
  const preSnapshotGates = buildPreSnapshotGates(
    core,
    pre.policy,
    pre.preflightGate,
    validation,
    input.operations.length,
    preflight.steps.length,
  );
  const auditGates: GateEvaluation[] = [
    buildGateResult("diff", core.config.gateModes.diff, true, undefined, {
      delta: diff.delta,
      affectedObjects: diff.affectedObjects ?? [],
    }),
    buildGateResult("risk", core.config.gateModes.risk, true, undefined, {
      level: risk.level,
      score: risk.score,
      tags: risk.tags,
    }),
  ];
  const approvalGate = buildGateResult(
    "approval",
    core.config.gateModes.approval,
    !risk.requiresApproval,
    risk.requiresApproval
      ? `Risk level '${risk.level}' requires approval (threshold=${core.config.approvalRiskThreshold}).`
      : undefined,
    {
      requiresApproval: risk.requiresApproval,
      riskLevel: risk.level,
    },
  );
  const gates: GateEvaluation[] = [
    ...preSnapshotGates,
    ...auditGates,
    approvalGate,
  ];

  // bei mehreren Blocks -> Infeasibility hat Vorrang vor Approval
  const blockedGate =
    gates.find((gate) => gate.blocked && gate.category === "infeasibility") ??
    gates.find((gate) => gate.blocked);
  const approvalBlocked = blockedGate?.gate === "approval";
  const hasHardBlockedGate = Boolean(
    blockedGate && (!approvalBlocked || core.config.executionMode === "auto"),
  );
  const pendingManualApproval =
    core.config.executionMode === "manual" &&
    approvalGate.blocked &&
    !hasHardBlockedGate;

  let decision: MslPayload["decision"] = "approved";
  let reason: string | undefined;
  let planStatus: PlanRecord["status"] = "approved";
  if (hasHardBlockedGate && blockedGate) {
    decision = "blocked";
    reason = blockedGate.reason;
    planStatus = "blocked";
  } else if (pendingManualApproval) {
    decision = "not_evaluated";
    reason = `Plan '${planId}' requires manual approval before apply.`;
    planStatus = "preflighted";
  }
  const now = new Date().toISOString();
  const approvalReasoning = buildApprovalReasoning({
    risk,
    validation,
    diff,
    policy: pre.policy,
  });

  const planRecord: PlanRecord = {
    planId,
    sessionId: session.sessionId,
    actorId: input.actorId,
    chatId: session.chatId,
    projectId: input.projectId,
    adapterId: core.adapter.adapterId,
    userComment: input.userComment,
    status: planStatus,
    decision,
    decisionReason: reason,
    approvalReasoning,
    baselineHash: pre.baselineHash,
    candidateHash,
    operations: input.operations,
    mcpCall: input.mcpCall,
    gates,
    risk,
    diff,
    policyViolations: pre.policy.violations,
    validation,
    createdAt: now,
    decidedAt: now,
  };
  await persistPlan(core, {
    plan: planRecord,
    preflightPayload: {
      operationKinds: pre.operationKinds,
      operationCount: input.operations.length,
      riskLevel: risk.level,
    },
    decisionPayload: { decision, reason },
    createdPayload: {
      operationKinds: pre.operationKinds,
      operationCount: input.operations.length,
      riskLevel: risk.level,
    },
    auditPayload: {
      at: now,
      sessionId: session.sessionId,
      planId,
      projectId: input.projectId,
      actorId: input.actorId,
      userComment: input.userComment,
      gateModes: core.config.gateModes,
      decision,
      reason,
      operationKinds: pre.operationKinds,
      operationCount: input.operations.length,
      operations: input.operations,
      baselineHash: pre.baselineHash,
      candidateHash,
      risk,
      policy: pre.policy,
      validation,
      diff,
    },
  });

  const mslPayload: MslPayload = {
    enabled: true,
    decision,
    reason,
    executionMode: core.config.executionMode,
    requiresManualApply: core.config.executionMode === "manual",
    sessionId: session.sessionId,
    planId,
    baselineHash: pre.baselineHash,
    candidateHash,
    gateModes: core.config.gateModes,
    gates,
    risk,
    diff,
    approvalReasoning,
    approvalReasoningStructured: buildApprovalReasoningStructured({
      risk,
      validation,
      diff,
      policy: pre.policy,
    }),
  };

  if (hasHardBlockedGate) {
    throw new MslRejectionError(
      blockedGate?.reason ?? "Operation blocked by MSL gate.",
      { planId, riskLevel: risk.level, mslPayload },
    );
  }

  return {
    mode:
      core.config.executionMode === "manual"
        ? "msl_manual_plan"
        : "msl_guarded_apply",
    nextDsl: preflight.nextSnapshot,
    steps: preflight.steps,
    summary: preflight.summary,
    msl: mslPayload,
  };
};

// === Stufe 1: Pre-Snapshot-Prüfung ===
// Rate-Limit-Zähler, Project-Lock, Pro-Operation-Verdicts und drei Batch-Gates

const runPreSnapshotStage = async (
  core: MslCore,
  input: ProcessInput,
  session: SessionRecord,
): Promise<PreSnapshotResult> => {
  const rateLimit = core.config.preflightRateLimit;
  const recentPlansForPreflight = await core.store.listPlansBySession({
    sessionId: session.sessionId,
    limit: Math.max(
      core.config.openPlanScanLimit,
      rateLimit.maxSameToolCalls * 2,
      20,
    ),
  });
  let recentSamePlanCount = 0;
  if (input.mcpCall?.name && rateLimit.maxSameToolCalls > 0) {
    const windowMs = Math.max(1000, rateLimit.windowSeconds * 1000);
    const cutoff = new Date(Date.now() - windowMs).toISOString();
    for (const plan of recentPlansForPreflight) {
      if (
        plan.mcpCall?.name === input.mcpCall.name &&
        plan.createdAt >= cutoff
      ) {
        recentSamePlanCount += 1;
      }
    }
  }
  const openPlanCount = recentPlansForPreflight.filter((plan) =>
    isOpenPlanStatus(plan.status),
  ).length;

  let lockViolation: string | undefined;
  if (core.config.projectLockMode !== "off") {
    const lock = await core.store.tryAcquireProjectLock({
      projectId: input.projectId,
      sessionId: session.sessionId,
      actorId: input.actorId,
      chatId: session.chatId,
      ttlSeconds: core.config.projectLockTtlSeconds,
    });
    if (!lock.acquired) {
      lockViolation = `Project '${input.projectId}' is locked by session '${lock.ownerSessionId ?? "unknown"}'.`;
    }
  }

  // bei Bulk Batch wird die Operations Liste mit Index und Grund ans LLM gegeben
  // "Reviewed Plan == Applied Plan" nicht teil apply
  const existingEntityIds = core.adapter.listEntityIds(input.baselineDsl);
  const opVerdicts = computeOpVerdicts({
    operations: input.operations,
    existingEntityIds,
    policy: core.config.policy,
    operationIndexes: input.operationIndexes,
  });
  const infeasibleVerdicts = opVerdicts.filter(isInfeasibleVerdict);
  const verdictPartition = partitionVerdictErrors(opVerdicts);

  const preflightGate = evaluatePreflight({
    toolName: input.mcpCall?.name,
    operations: input.operations,
    existingEntityIds,
    recentSamePlanCount,
    rateLimit,
    openPlanCount,
    maxOpenPlansPerSession: core.config.maxOpenPlansPerSession,
    openPlanModeBlock:
      core.config.executionMode === "manual" &&
      core.config.openPlanMode === "block",
    lockViolation,
  });
  preflightGate.violations.push(...verdictPartition.preflightErrors);
  preflightGate.passed = preflightGate.violations.length === 0;
  if (infeasibleVerdicts.length > 0) {
    const missingEntityRefs = infeasibleVerdicts
      .filter((verdict) => verdict.preflightErrors.length > 0)
      .map((verdict) => `'${verdict.componentId}' (op=${verdict.opKind})`);
    preflightGate.details = {
      ...(preflightGate.details ?? {}),
      opVerdicts: infeasibleVerdicts.map((verdict) => ({
        operationIndex: verdict.operationIndex,
        opKind: verdict.opKind,
        componentId: verdict.componentId,
        policyErrors: verdict.policyErrors,
        preflightErrors: verdict.preflightErrors,
        validationErrors: verdict.validationErrors,
      })),
      ...(missingEntityRefs.length > 0 ? { missingEntityRefs } : {}),
    };
  }

  // Policy prüft keine Lock-Violation, das machen Preflight (hartes Block) und Risk (elevateRiskForLockConflict)
  const policy = evaluatePolicy(input.operations, core.config.policy);
  policy.violations.push(...verdictPartition.policyErrors);
  policy.passed = policy.violations.length === 0;

  const contentScanResults = scanOperationsForDangerousContent(
    input.operations,
  );
  const genericValidation = evaluateGenericValidation(
    input.operations,
    contentScanResults,
  );
  genericValidation.errors.push(...verdictPartition.validationErrors);
  genericValidation.passed = genericValidation.errors.length === 0;
  const operationKinds = input.operations.map((operation) => operation.kind);

  return {
    recentSamePlanCount,
    openPlanCount,
    lockViolation,
    existingEntityIds,
    contentScanResults,
    opVerdicts,
    policy,
    preflightGate,
    genericValidation,
    operationKinds,
    baselineHash: hashObject(input.baselineDsl),
  };
};

// === Stufe 2 / 3 Block-Plan-Builder ===
// Geteilte Block-Plan-Erzeugung für Stufe-2-Fail-Fast und Adapter-Crash

const assembleBlockedPlan = async (
  core: MslCore,
  args: {
    input: ProcessInput;
    session: SessionRecord;
    pre: PreSnapshotResult;
    validation: ValidationResult;
    reason: string;
    diffSummary: string;
    preflightExtras?: Record<string, unknown>;
    decisionExtras?: Record<string, unknown>;
    createdExtras?: Record<string, unknown>;
    auditExtras?: Record<string, unknown>;
  },
): Promise<{ planId: string; mslPayload: MslPayload }> => {
  const { input, session, pre, validation, reason, diffSummary } = args;
  const at = new Date().toISOString();
  const planId = `plan_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const blockedGates = buildPreSnapshotGates(
    core,
    pre.policy,
    pre.preflightGate,
    validation,
    input.operations.length,
  );
  const blockedPlan: PlanRecord = {
    planId,
    sessionId: session.sessionId,
    actorId: input.actorId,
    chatId: session.chatId,
    projectId: input.projectId,
    adapterId: core.adapter.adapterId,
    userComment: input.userComment,
    status: "blocked",
    decision: "blocked",
    decisionReason: reason,
    approvalReasoning: reason,
    baselineHash: pre.baselineHash,
    candidateHash: pre.baselineHash,
    operations: input.operations,
    mcpCall: input.mcpCall,
    gates: blockedGates,
    risk: {
      level: "low",
      score: 0,
      tags: [],
      reasons: [],
      requiresApproval: false,
    },
    diff: buildEmptyDiffForBlock(pre.operationKinds, diffSummary),
    policyViolations: pre.policy.violations,
    validation,
    createdAt: at,
    decidedAt: at,
  };
  await persistPlan(core, {
    plan: blockedPlan,
    preflightPayload: {
      operationKinds: pre.operationKinds,
      operationCount: input.operations.length,
      ...(args.preflightExtras ?? {}),
    },
    decisionPayload: {
      decision: "blocked",
      category: "infeasibility",
      reason,
      ...(args.decisionExtras ?? {}),
    },
    createdPayload: {
      category: "infeasibility",
      operationKinds: pre.operationKinds,
      operationCount: input.operations.length,
      ...(args.createdExtras ?? {}),
    },
    auditPayload: {
      at,
      sessionId: session.sessionId,
      planId,
      projectId: input.projectId,
      actorId: input.actorId,
      gateModes: core.config.gateModes,
      decision: "blocked",
      category: "infeasibility",
      reason,
      operationKinds: pre.operationKinds,
      operationCount: input.operations.length,
      ...(args.auditExtras ?? {}),
    },
  });
  // MslPayload spiegelt das PlanRecord, damit Frontend einen einheitlichen
  // Shape sieht (sonst müsste UI Stufe-2-blockiert vs Stufe-5-blockiert
  // separat behandeln)
  const mslPayload: MslPayload = {
    enabled: true,
    decision: "blocked",
    reason,
    executionMode: core.config.executionMode,
    requiresManualApply: core.config.executionMode === "manual",
    sessionId: session.sessionId,
    planId,
    baselineHash: pre.baselineHash,
    candidateHash: pre.baselineHash,
    gateModes: core.config.gateModes,
    gates: blockedGates,
    risk: blockedPlan.risk,
    diff: blockedPlan.diff,
    approvalReasoning: reason,
  };
  return { planId, mslPayload };
};

// Pre-Snapshot-Gates (policy/preflight/validation) als GateEvaluation-Tripel
// stepCount nur für den approved-Pfad, undefined für FailFast/Adapter-Crash
const buildPreSnapshotGates = (
  core: MslCore,
  policy: PolicyResult,
  preflight: PreflightResult,
  validation: ValidationResult,
  operationCount: number,
  stepCount?: number,
): GateEvaluation[] => {
  const preflightDetails: Record<string, unknown> = {
    operationCount,
    ...(stepCount !== undefined ? { steps: stepCount } : {}),
    ...(preflight.details ?? {}),
  };
  return [
    buildGateResult(
      "policy",
      core.config.gateModes.policy,
      policy.passed,
      policy.violations.join(" ") || undefined,
      { violations: policy.violations },
    ),
    buildGateResult(
      "preflight",
      core.config.gateModes.preflight,
      preflight.passed,
      preflight.violations.join(" ") || undefined,
      preflightDetails,
    ),
    buildGateResult(
      "validation",
      core.config.gateModes.validation,
      validation.passed,
      validation.errors.join(" ") || undefined,
      {
        errors: validation.errors,
        warnings: renderWarningsForWire(validation.warnings),
      },
    ),
  ];
};

const persistPlan = async (
  core: MslCore,
  args: {
    plan: PlanRecord;
    preflightPayload: Record<string, unknown>;
    decisionPayload: Record<string, unknown>;
    createdPayload: Record<string, unknown>;
    auditPayload?: Record<string, unknown>;
  },
): Promise<void> => {
  const { plan } = args;
  const decidedAt = plan.decidedAt ?? plan.createdAt;
  await core.store.createPlan(plan);
  await core.store.appendPlanEvent({
    eventId: randomUUID(),
    planId: plan.planId,
    sessionId: plan.sessionId,
    eventType: "preflight",
    payload: args.preflightPayload,
    createdAt: plan.createdAt,
  });
  emitPlanEvent(core, {
    eventType: "plan.created",
    at: plan.createdAt,
    planId: plan.planId,
    sessionId: plan.sessionId,
    projectId: plan.projectId,
    status: plan.status,
    decision: plan.decision,
    reason: plan.decisionReason,
    payload: args.createdPayload,
  });
  await core.store.appendPlanEvent({
    eventId: randomUUID(),
    planId: plan.planId,
    sessionId: plan.sessionId,
    eventType: "decision",
    payload: args.decisionPayload,
    createdAt: decidedAt,
  });
  emitPlanEvent(core, {
    eventType: "plan.decision",
    at: decidedAt,
    planId: plan.planId,
    sessionId: plan.sessionId,
    projectId: plan.projectId,
    status: plan.status,
    decision: plan.decision,
    reason: plan.decisionReason,
  });
  if (core.config.gateModes.audit !== "off" && args.auditPayload) {
    await writeAuditEvent(core.config.dataDir, args.auditPayload);
  }
};

// Leerer DiffResult für blockierte Plans (Stufe 2 oder Adapter-Crash)
// affectedObjects=[] und Null-Counts da keine Änderung berechnet wurde
const buildEmptyDiffForBlock = (
  operationKinds: string[],
  diffSummary: string,
): DiffResult => ({
  before: {},
  after: {},
  delta: {
    componentCount: 0,
    queryCount: 0,
    tempStateCount: 0,
    jsLibraryCount: 0,
  },
  operationKinds,
  affectedObjects: [],
  diffSummary,
});
