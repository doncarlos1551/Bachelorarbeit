import type {
  PolicyResult,
  RiskResult,
  RiskTag,
  ValidationResult,
} from "src/msl/gates/gates.interfaces";
import type { DiffResult } from "src/msl/payload/diff.interfaces";
import type { ApprovalReasoningStructured } from "src/msl/payload/payload.interfaces";
import {
  renderWarningsForWire,
  sortWarningsBySeverity,
} from "src/msl/gates/validation";

// === Approval Gate ===
// Approval-Reasoning für LLM-Wire (Plain-String) und UI (strukturiert)
// - Kategorie risky, blockt nur bei manueller Approval-Pflicht
// @ToDo i18n
interface ApprovalReasoningInput {
  risk: RiskResult;
  validation: ValidationResult;
  diff: DiffResult;
  policy: PolicyResult;
}

interface ApprovalReasoningParts {
  uniqueReasons: string[];
  sortedWarnings: string[];
  recommendations: string[];
  externalEndpoints: string[];
  changes: string[];
}

const MAX_REASONS_IN_TEXT = 5;
const MAX_WARNINGS_IN_TEXT = 8;
const MAX_CHANGES_IN_TEXT = 8;

// Detail-Änderungen aus structuralDiff.humanSummary
// fallback auf vagen diffSummary einzeler falls kein structural-diff vorliegt
// (zB Stufe-2-blockiert, kein adapter-snapshot)
const collectChanges = (diff: DiffResult): string[] => {
  const human = diff.structuralDiff?.humanSummary ?? [];
  if (human.length > 0) return human;
  return diff.diffSummary ? [diff.diffSummary] : [];
};

const buildRecommendations = (
  tags: RiskTag[],
  hasExternalEndpoints: boolean,
): string[] => {
  const recommendations: string[] = [];
  if (tags.includes("R_DELETE")) {
    recommendations.push(
      "Prüfen Sie ob die Löschung beabsichtigt ist und keine abhängigen Komponenten betroffen sind.",
    );
  }
  if (tags.includes("R_EXTERNAL_IO") || hasExternalEndpoints) {
    recommendations.push(
      "Prüfen Sie ob die externen URLs vertrauenswürdig sind.",
    );
  }
  if (tags.includes("R_CONTENT_INJECTION")) {
    recommendations.push(
      "ACHTUNG: Potenziell gefährlicher Code erkannt. Inhalt sorgfältig prüfen.",
    );
  }
  if (tags.includes("R_SCRIPT") || tags.includes("R_PRELOAD")) {
    recommendations.push(
      "Prüfen Sie ob die Skript-Änderungen erwartetem Verhalten entsprechen.",
    );
  }
  if (tags.includes("R_BULK_CHANGE")) {
    recommendations.push(
      "Große Batch-Änderung: Prüfen Sie ob alle Operationen zusammengehören.",
    );
  }
  return recommendations;
};

const computeApprovalReasoningParts = (
  input: ApprovalReasoningInput,
): ApprovalReasoningParts => {
  const externalEndpoints = input.diff.externalEndpoints ?? [];
  return {
    uniqueReasons: [...new Set(input.risk.reasons)],
    sortedWarnings: renderWarningsForWire(
      sortWarningsBySeverity(input.validation.warnings),
    ),
    recommendations: buildRecommendations(
      input.risk.tags,
      externalEndpoints.length > 0,
    ),
    externalEndpoints,
    changes: collectChanges(input.diff),
  };
};

export const buildApprovalReasoningStructured = (
  input: ApprovalReasoningInput,
): ApprovalReasoningStructured => {
  const parts = computeApprovalReasoningParts(input);
  return {
    riskScore: input.risk.score,
    riskLevel: input.risk.level,
    reasons: parts.uniqueReasons,
    tags: input.risk.tags,
    policyViolations: input.policy.violations,
    warnings: parts.sortedWarnings,
    errors: input.validation.errors,
    externalEndpoints: parts.externalEndpoints,
    recommendations: parts.recommendations,
    changes: parts.changes,
  };
};

export const buildApprovalReasoning = (
  input: ApprovalReasoningInput,
): string => {
  const parts = computeApprovalReasoningParts(input);
  const lines: string[] = [];

  lines.push(`Risk Score ${input.risk.score} (${input.risk.level}).`);

  appendBulletSection(
    lines,
    "Gründe:",
    parts.uniqueReasons,
    MAX_REASONS_IN_TEXT,
  );

  if (input.risk.tags.length > 0) {
    lines.push("");
    lines.push(`Tags: ${input.risk.tags.join(", ")}`);
  }

  appendBulletSection(lines, "Policy-Verstöße:", input.policy.violations);
  appendBulletSection(
    lines,
    "Warnungen:",
    parts.sortedWarnings,
    MAX_WARNINGS_IN_TEXT,
  );
  appendBulletSection(lines, "Fehler:", input.validation.errors);

  // Änderungen detailliert wenn structuralDiff verfügbar sonst vage Einzeiler
  if (parts.changes.length > 1) {
    appendBulletSection(
      lines,
      "Änderungen:",
      parts.changes,
      MAX_CHANGES_IN_TEXT,
    );
  } else if (parts.changes.length === 1) {
    lines.push("");
    lines.push(`Änderungen: ${parts.changes[0]}`);
  }

  appendBulletSection(lines, "Externe Endpunkte:", parts.externalEndpoints);

  if (parts.recommendations.length > 0) {
    lines.push("");
    lines.push("Empfehlungen:");
    for (const recommendation of parts.recommendations) {
      lines.push(`-> ${recommendation}`);
    }
  }

  return lines.join("\n");
};

const appendBulletSection = (
  lines: string[],
  heading: string,
  items: string[],
  limit?: number,
): void => {
  if (items.length === 0) return;
  lines.push("");
  lines.push(heading);
  const visible = limit !== undefined ? items.slice(0, limit) : items;
  for (const item of visible) {
    lines.push(`- ${item}`);
  }
  if (limit !== undefined && items.length > limit) {
    lines.push(`- ... und ${items.length - limit} weitere`);
  }
};
