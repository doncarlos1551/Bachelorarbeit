import type { BaselineOperation } from "src/app/operations";
import type {
  ImpactInfo,
  RiskResult,
  RiskTag,
  RuntimeRiskLevel,
} from "src/msl/gates/gates.interfaces";
import {
  scanOperationsForDangerousContent,
  type ContentScanResult,
} from "src/msl/content-scanner";

const CASCADE_IMPACT_BONUS = 40;
const DIRECT_IMPACT_BONUS = 20;

export const riskSeverity: Record<RuntimeRiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

export const RISK_LEVEL_THRESHOLDS = {
  high: 80,
  medium: 45,
} as const;

const DEFAULT_OP_TYPE_SCORE = 10;
const BULK_BONUS_FACTOR = 10;
const DIVERSITY_BONUS_PER_TAG = 5;
const LOCK_CONFLICT_FLOOR_SCORE = 90;

interface OpRiskProfile {
  score: number;
  tag: RiskTag;
  reason: string;
}

const PRELOAD_PROFILE: OpRiskProfile = {
  score: 70,
  tag: "R_PRELOAD",
  reason: "Preload-Änderung beeinflusst globales Laufzeitverhalten.",
};

const EXTERNAL_IO_PROFILE: OpRiskProfile = {
  score: 55,
  tag: "R_EXTERNAL_IO",
  reason: "Datenquellenänderung beeinflusst externe Kommunikation.",
};

const OP_RISK_PROFILES: Partial<
  Record<BaselineOperation["kind"], OpRiskProfile>
> = {
  "ui.remove_component": {
    score: 90,
    tag: "R_DELETE",
    reason: "Komponentenlöschung kann UI-Elemente und Verknüpfungen entfernen.",
  },
  "logic.upsert_function": {
    score: 75,
    tag: "R_SCRIPT",
    reason: "Funktionsänderung verändert ausführbares Skriptverhalten.",
  },
  "logic.set_component_action": {
    score: 65,
    tag: "R_ACTION",
    reason: "Event-Handler-Änderung verändert Laufzeitverhalten.",
  },
  "preload.add_js_library": PRELOAD_PROFILE,
  "preload.set_script": PRELOAD_PROFILE,
  "preload.set_css": PRELOAD_PROFILE,
  "preload.set_global_css": PRELOAD_PROFILE,
  "integration.upsert_http_datasource": EXTERNAL_IO_PROFILE,
  "integration.bind_component_datasource": EXTERNAL_IO_PROFILE,
  "ui.rename_component": {
    score: 40,
    tag: "R_REFERENCE",
    reason: "Umbenennung kann abhängige Referenzen brechen.",
  },
};

// Operationstyp-Tags zählen in den Diversity-Bonus aber Content-Tags nicht
const DIVERSITY_TAGS: ReadonlySet<RiskTag> = new Set<RiskTag>([
  "R_DELETE",
  "R_SCRIPT",
  "R_ACTION",
  "R_PRELOAD",
  "R_EXTERNAL_IO",
  "R_REFERENCE",
]);

export const riskLevelFromScore = (
  score: number,
  fallback: RuntimeRiskLevel = "low",
): RuntimeRiskLevel => {
  if (score >= RISK_LEVEL_THRESHOLDS.high) return "high";
  if (score >= RISK_LEVEL_THRESHOLDS.medium) return "medium";
  return fallback;
};

// === Risk Gate ===
// Score und Kategorisierung, Kategorie audit (blockt selbst nie, speist Approval)
// - Schritt 1: Op-Type-Score (delete=90, script=75, action=65, preload=70, external_io=55, rename=40)
// - Schritt 2: Content-Scan-Score (HIGH addiert auf Typscore, sonst Maximum)
// - Schritt 3: Effektivscore pro Operation (max von Type und Content, ausser HIGH-Content)
// - Schritt 4: Batch-Aggregation (max(opScores) + bulk(log2 n)*10 + diversity*5)
// - Tags: R_DELETE, R_SCRIPT, R_ACTION, R_PRELOAD, R_EXTERNAL_IO, R_REFERENCE, R_BULK_CHANGE, R_CONTENT_*, R_CASCADE_IMPACT, R_EXCLUSIVE_LOCK
// - Level: high>=80, medium>=45 sonst low
// - requiresApproval: level >= gesetzter threshold
export const evaluateRisk = (
  operations: BaselineOperation[],
  threshold: "medium" | "high",
  scanResults: ContentScanResult[] = scanOperationsForDangerousContent(
    operations,
  ),
): RiskResult => {
  const tags = new Set<RiskTag>();
  const reasons: string[] = [];

  // Schritt 1: Score pro Operation-Typ
  const typeScores = operations.map((operation) => {
    const profile = OP_RISK_PROFILES[operation.kind];
    if (!profile) return DEFAULT_OP_TYPE_SCORE;
    tags.add(profile.tag);
    reasons.push(profile.reason);
    return profile.score;
  });

  // Schritt 2: Content-Scan auf gefährliche Patterns
  // HIGH-Treffer addieren auf den Typscore, sonst Maximum (siehe OWASP Agentic Top 10 ASI09)
  const contentScores = new Array(operations.length).fill(0);
  const contentHasHighSeverity = new Array(operations.length).fill(false);
  for (const result of scanResults) {
    const operationIndex = operations.findIndex(
      (operation) => operation.kind === result.operationKind,
    );
    if (operationIndex < 0) continue;
    const maxHitScore = Math.max(...result.hits.map((hit) => hit.riskPoints));
    contentScores[operationIndex] = Math.max(
      contentScores[operationIndex],
      maxHitScore,
    );
    for (const hit of result.hits) {
      if (hit.severity === "high") {
        tags.add("R_CONTENT_INJECTION");
        reasons.push(`Gefährliches Muster in ${result.context}: ${hit.label}`);
        contentHasHighSeverity[operationIndex] = true;
      } else if (hit.severity === "medium") {
        tags.add("R_CONTENT_SUSPICIOUS");
        reasons.push(`Verdächtiges Muster in ${result.context}: ${hit.label}`);
      }
    }
  }

  // Schritt 3: Effektivscore pro Operation
  const operationScores = operations.map((_, position) =>
    contentHasHighSeverity[position]
      ? typeScores[position] + contentScores[position]
      : Math.max(typeScores[position], contentScores[position]),
  );

  // Schritt 4: Batch-Aggregation
  // base = max(operationScores), bulk_bonus = ceil(log2(n)) * 10, diversity_bonus = unique_typetags * 5
  // Heuristische Designentscheidung, keine direkte Literaturformel. Rationale: viele und
  // heterogene Operationen erhoehen Reviewer-Last und Angriffsflaeche; log2 daempft, damit
  // grosse Batches nicht linear explodieren. Cognitive-Load-Anker Parasuraman/Riley 1997,
  // additive Risiko-Aggregation analog Ismail et al. 2025. Thesis-Begründung Kap. 4 Risk Gate.
  let score = 0;
  if (operations.length === 1) {
    score = operationScores[0];
  } else if (operations.length > 1) {
    const maxOperationScore = Math.max(...operationScores);
    const bulkBonus =
      Math.ceil(Math.log2(operations.length)) * BULK_BONUS_FACTOR;
    const diversityTagCount = [...tags].filter((tag) =>
      DIVERSITY_TAGS.has(tag),
    ).length;
    const diversityBonus = diversityTagCount * DIVERSITY_BONUS_PER_TAG;
    score = maxOperationScore + bulkBonus + diversityBonus;
    if (bulkBonus > 0) {
      tags.add("R_BULK_CHANGE");
      reasons.push(
        `Batch mit ${operations.length} Operationen (+${bulkBonus} bulk, +${diversityBonus} Tag-Diversität).`,
      );
    }
  }

  const level = riskLevelFromScore(score);
  const thresholdLevel: RuntimeRiskLevel =
    threshold === "medium" ? "medium" : "high";
  const requiresApproval = riskSeverity[level] >= riskSeverity[thresholdLevel];

  return { level, score, tags: [...tags], reasons, requiresApproval };
};

// Eskalation auf high und Approval-required Lock-Konflikt zwischen Sessions
export const elevateRiskForLockConflict = (
  risk: RiskResult,
  lockViolation?: string,
): RiskResult => {
  if (!lockViolation) return risk;
  return {
    ...risk,
    level: "high",
    score: Math.max(LOCK_CONFLICT_FLOOR_SCORE, risk.score),
    tags: [...new Set<RiskTag>([...risk.tags, "R_EXCLUSIVE_LOCK"])],
    reasons: [...risk.reasons, lockViolation],
    requiresApproval: true,
  };
};

// Risk-Anhebung basierend auf Blast-Radius (Bohner und Arnold 1996)
export const elevateRiskForImpacts = (
  risk: RiskResult,
  impacts: ImpactInfo[],
): RiskResult => {
  if (impacts.length === 0) return risk;
  const hasCascade = impacts.some((impact) => impact.kind === "cascade");
  const blastBonus = hasCascade ? CASCADE_IMPACT_BONUS : DIRECT_IMPACT_BONUS;
  const elevatedScore = risk.score + blastBonus;
  return {
    ...risk,
    score: elevatedScore,
    tags: [...new Set<RiskTag>([...risk.tags, "R_CASCADE_IMPACT"])],
    reasons: [...risk.reasons, ...impacts.map((impact) => impact.message)],
    level: riskLevelFromScore(elevatedScore, risk.level),
    requiresApproval:
      risk.requiresApproval || elevatedScore >= RISK_LEVEL_THRESHOLDS.medium,
  };
};
