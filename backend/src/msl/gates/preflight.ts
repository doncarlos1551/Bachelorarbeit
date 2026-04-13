import type { BaselineOperation } from "src/app/operations";
import type { MslPreflightRateLimit } from "src/msl/config";
import { type PreflightResult } from "src/msl/gates/shared";
import { componentIdOf } from "src/msl/gates/validation";

// === Preflight Gate ===
// Batch-Konsistenz und LLM-Burst-Schutz vor adapter.preflight, Kategorie infeasibility
// - Open-Plan-Queue-Limit (block-mode im manual-mode)
// - Project-Lock-Violation
// - Tool-Burst-Rate-Limit (gleicher Tool-Name in Window)
// - Self-Contradiction (Delete dann weitere Op auf gleicher Entity)
// - Rename-Kollision (neue ID kollidiert mit Baseline oder Add im selben Batch)
// - Mehrfach-Rename auf gleiche Entity
export const evaluatePreflight = (input: {
  toolName?: string;
  operations: BaselineOperation[];
  existingEntityIds: Set<string>;
  recentSamePlanCount: number;
  rateLimit: MslPreflightRateLimit;
  openPlanCount: number;
  maxOpenPlansPerSession: number;
  openPlanModeBlock: boolean;
  lockViolation?: string;
}): PreflightResult => {
  const violations: string[] = [];
  const details: Record<string, unknown> = {
    rateLimit: {
      windowSeconds: input.rateLimit.windowSeconds,
      maxSameToolCalls: input.rateLimit.maxSameToolCalls,
      recentSamePlanCount: input.recentSamePlanCount,
    },
    openPlanCount: input.openPlanCount,
    maxOpenPlansPerSession: input.maxOpenPlansPerSession,
  };

  if (
    input.openPlanModeBlock &&
    input.openPlanCount >= input.maxOpenPlansPerSession
  ) {
    violations.push(
      `Session hat ${input.openPlanCount} offene Plans (Limit ${input.maxOpenPlansPerSession}). ` +
        `Bitte offene Plans zuerst freigeben oder ablehnen, bevor neue Operationen eingereicht werden.`,
    );
  }

  if (input.lockViolation) {
    violations.push(`Projekt-Lock: ${input.lockViolation}`);
    details.lockViolation = input.lockViolation;
  }

  if (
    input.toolName &&
    input.rateLimit.maxSameToolCalls > 0 &&
    input.recentSamePlanCount >= input.rateLimit.maxSameToolCalls
  ) {
    violations.push(
      `Preflight-Rate-Limit: ${input.recentSamePlanCount}× '${input.toolName}' innerhalb von ` +
        `${input.rateLimit.windowSeconds}s. Statt vieler Einzelaufrufe bitte '${input.rateLimit.recommendedBatchTool}' ` +
        `mit allen Operationen in einem einzigen Call verwenden. Argument-Shape: ` +
        `{ "operations": [ { "kind": "...", ... }, ... ] }, das Feld 'operations' ist Pflicht. ` +
        `Mit 'list_operation_kinds' die verfügbaren kinds und Pflichtfelder abrufen, falls unklar.`,
    );
    details.matchedTool = input.toolName;
  }

  const selfContradictions = collectSelfContradictions(
    input.operations,
    input.existingEntityIds,
  );
  if (selfContradictions.length > 0) {
    violations.push(
      `Selbstwidersprüche in der Batch: ${selfContradictions.join("; ")}.`,
    );
    details.selfContradictions = selfContradictions;
  }

  return { passed: violations.length === 0, violations, details };
};

// Self-Contradictions in einer Batch
// - Delete dann weitere Op auf gleicher Entity
// - Rename-Ziel kollidiert mit Baseline oder Add im selben Batch
// - Mehrfach-Rename auf gleiche Entity
// - Op auf bereits umbenannter Entity unter altem Namen
const collectSelfContradictions = (
  operations: BaselineOperation[],
  existingEntityIds: Set<string>,
): string[] => {
  const selfContradictions: string[] = [];
  const deletedInBatch = new Set<string>();
  const renamedInBatch = new Map<string, string>();
  const addedInBatch = new Set<string>();

  for (const operation of operations) {
    const componentId = componentIdOf(operation);

    if (operation.kind === "ui.add_component") {
      if (componentId) addedInBatch.add(componentId);
      continue;
    }
    if (componentId && deletedInBatch.has(componentId)) {
      selfContradictions.push(
        `Nach Löschen von '${componentId}' folgt weitere Operation '${operation.kind}' auf derselben Entity`,
      );
    }
    if (componentId) {
      const renameTarget = renamedInBatch.get(componentId);
      if (renameTarget) {
        selfContradictions.push(
          `Nach Umbenennung '${componentId}' -> '${renameTarget}' folgt weitere Operation '${operation.kind}' auf altem Namen`,
        );
      }
    }
    if (operation.kind === "ui.remove_component" && componentId) {
      deletedInBatch.add(componentId);
    }
    if (operation.kind === "ui.rename_component") {
      const newId = operation.newComponentId.trim();
      if (componentId && newId) {
        if (renamedInBatch.has(componentId)) {
          selfContradictions.push(
            `Entity '${componentId}' wird mehrfach umbenannt`,
          );
        }
        if (existingEntityIds.has(newId) && newId !== componentId) {
          selfContradictions.push(
            `Rename-Ziel '${newId}' existiert bereits in der Baseline (Namenskollision)`,
          );
        }
        if (addedInBatch.has(newId)) {
          selfContradictions.push(
            `Rename-Ziel '${newId}' wurde in derselben Batch bereits hinzugefügt (Kollision)`,
          );
        }
        renamedInBatch.set(componentId, newId);
      }
    }
  }

  return selfContradictions;
};
