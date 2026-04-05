import path from "node:path";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import sqlite3 from "sqlite3";
import { open, type Database } from "sqlite";
import type {
  RiskResult,
  ValidationResult,
  ValidationWarning,
} from "src/msl/gates/gates.interfaces";
import { isRiskTag } from "src/msl/gates/gates.interfaces";
import type { DiffResult } from "src/msl/payload/diff.interfaces";
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
import type { MslStore } from "src/msl/store/store.interfaces";
import { hashSessionToken } from "src/msl/utils";
import { isRecord } from "src/shared/utils";

type SqliteRow = Record<string, unknown>;

export class SqliteMslStore implements MslStore {
  private readonly dbPath: string;
  private readonly defaultProjectLockTtlSeconds: number;
  private dbPromise:
    | Promise<Database<sqlite3.Database, sqlite3.Statement>>
    | undefined;

  constructor(dbPath: string, defaultProjectLockTtlSeconds: number) {
    this.dbPath = dbPath;
    this.defaultProjectLockTtlSeconds = defaultProjectLockTtlSeconds;
  }

  async ensureSession(input: EnsureSessionInput): Promise<SessionRecord> {
    const db = await this.getDb();
    const now = new Date().toISOString();
    const tokenHash = hashSessionToken(input.sessionToken);
    const requestedSessionId = input.sessionId?.trim();

    let row: SqliteRow | undefined;
    if (requestedSessionId) {
      row = (await db.get(
        "SELECT * FROM sessions WHERE session_id = ?",
        requestedSessionId,
      )) as SqliteRow | undefined;
    } else if (tokenHash) {
      row = (await db.get(
        "SELECT * FROM sessions WHERE session_token_hash = ?",
        tokenHash,
      )) as SqliteRow | undefined;
    }

    if (row) {
      const sessionId = readDbText(row.session_id);
      const nextChatId = input.chatId ?? readOptionalDbText(row.chat_id);
      const nextProjectId =
        input.projectId ?? readOptionalDbText(row.last_project_id);
      await db.run(
        "UPDATE sessions SET actor_id = ?, chat_id = ?, last_project_id = ?, updated_at = ?, session_token_hash = COALESCE(?, session_token_hash) WHERE session_id = ?",
        input.actorId,
        nextChatId ?? null,
        nextProjectId ?? null,
        now,
        tokenHash ?? null,
        sessionId,
      );

      return {
        sessionId,
        sessionTokenHash:
          tokenHash ?? readOptionalDbText(row.session_token_hash),
        actorId: input.actorId,
        chatId: nextChatId,
        lastProjectId: nextProjectId,
        createdAt: readDbText(row.created_at),
        updatedAt: now,
      };
    }

    const sessionId =
      requestedSessionId || `sess_${randomUUID().replace(/-/g, "")}`;
    await db.run(
      "INSERT INTO sessions (session_id, session_token_hash, actor_id, chat_id, last_project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      sessionId,
      tokenHash ?? null,
      input.actorId,
      input.chatId ?? null,
      input.projectId ?? null,
      now,
      now,
    );

    return {
      sessionId,
      sessionTokenHash: tokenHash,
      actorId: input.actorId,
      chatId: input.chatId,
      lastProjectId: input.projectId,
      createdAt: now,
      updatedAt: now,
    };
  }

  async createPlan(record: PlanRecord): Promise<void> {
    const db = await this.getDb();
    await db.run(
      [
        "INSERT OR REPLACE INTO plans (",
        "plan_id, session_id, actor_id, chat_id, project_id, adapter_id, user_comment, status, decision, decision_reason, approval_reasoning,",
        "baseline_hash, candidate_hash, operations_json, mcp_call_json, gates_json, risk_json, diff_json, policy_violations_json, validation_json,",
        "created_at, decided_at, applied_at",
        ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ].join(" "),
      record.planId,
      record.sessionId,
      record.actorId,
      record.chatId ?? null,
      record.projectId,
      record.adapterId,
      record.userComment ?? null,
      record.status,
      record.decision,
      record.decisionReason ?? null,
      record.approvalReasoning ?? null,
      record.baselineHash,
      record.candidateHash,
      JSON.stringify(record.operations),
      record.mcpCall ? JSON.stringify(record.mcpCall) : null,
      JSON.stringify(record.gates),
      JSON.stringify(record.risk),
      JSON.stringify(record.diff),
      JSON.stringify(record.policyViolations),
      JSON.stringify(record.validation),
      record.createdAt,
      record.decidedAt ?? null,
      record.appliedAt ?? null,
    );
  }

  async appendPlanEvent(event: PlanEvent): Promise<void> {
    const db = await this.getDb();
    await db.run(
      "INSERT INTO plan_events (event_id, plan_id, session_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      event.eventId,
      event.planId,
      event.sessionId,
      event.eventType,
      JSON.stringify(event.payload),
      event.createdAt,
    );
  }

  async updatePlan(planId: string, update: PlanUpdate): Promise<void> {
    const db = await this.getDb();
    const existing = (await db.get(
      "SELECT * FROM plans WHERE plan_id = ?",
      planId,
    )) as SqliteRow | undefined;
    if (!existing) {
      return;
    }
    const status = update.status ?? readDbText(existing.status);
    const decision = update.decision ?? readDbText(existing.decision);
    const decisionReason =
      update.decisionReason ?? readOptionalDbText(existing.decision_reason);
    const approvalReasoning =
      update.approvalReasoning ??
      readOptionalDbText(existing.approval_reasoning);
    const decidedAt =
      update.decidedAt ?? readOptionalDbText(existing.decided_at);
    const appliedAt =
      update.appliedAt ?? readOptionalDbText(existing.applied_at);

    await db.run(
      "UPDATE plans SET status = ?, decision = ?, decision_reason = ?, approval_reasoning = ?, decided_at = ?, applied_at = ? WHERE plan_id = ?",
      status,
      decision,
      decisionReason ?? null,
      approvalReasoning ?? null,
      decidedAt ?? null,
      appliedAt ?? null,
      planId,
    );
  }

  async getPlan(planId: string): Promise<PlanRecord | undefined> {
    const db = await this.getDb();
    const row = (await db.get(
      "SELECT * FROM plans WHERE plan_id = ?",
      planId,
    )) as SqliteRow | undefined;
    return row ? decodePlanRow(row) : undefined;
  }

  async listPlansBySession(filter: PlanListFilter): Promise<PlanRecord[]> {
    const db = await this.getDb();
    const rows = (await db.all(
      "SELECT * FROM plans WHERE session_id = ? ORDER BY created_at DESC LIMIT ?",
      filter.sessionId,
      filter.limit,
    )) as SqliteRow[];
    return rows.map((row) => decodePlanRow(row));
  }

  async listPlans(limit: number): Promise<PlanRecord[]> {
    const db = await this.getDb();
    const rows = (await db.all(
      "SELECT * FROM plans ORDER BY created_at DESC LIMIT ?",
      limit,
    )) as SqliteRow[];
    return rows.map((row) => decodePlanRow(row));
  }

  async listPlanEvents(planId: string): Promise<PlanEvent[]> {
    const db = await this.getDb();
    const rows = (await db.all(
      "SELECT * FROM plan_events WHERE plan_id = ? ORDER BY created_at ASC",
      planId,
    )) as SqliteRow[];
    return rows.map((row) => decodePlanEventRow(row));
  }

  async tryAcquireProjectLock(
    request: ProjectLockRequest,
  ): Promise<ProjectLockResult> {
    const db = await this.getDb();
    const nowMs = Date.now();
    const ttlSeconds =
      request.ttlSeconds > 0
        ? request.ttlSeconds
        : this.defaultProjectLockTtlSeconds;
    const expiresAt = new Date(nowMs + ttlSeconds * 1000).toISOString();
    const nowIso = new Date(nowMs).toISOString();

    await db.exec("BEGIN IMMEDIATE TRANSACTION");
    try {
      const current = (await db.get(
        "SELECT session_id, expires_at FROM project_locks WHERE project_id = ?",
        request.projectId,
      )) as SqliteRow | undefined;

      if (current) {
        const ownerSessionId = readDbText(current.session_id);
        const expiresAtRaw = readDbText(current.expires_at);
        const currentExpiresMs = Date.parse(expiresAtRaw);
        if (
          ownerSessionId !== request.sessionId &&
          Number.isFinite(currentExpiresMs) &&
          currentExpiresMs > nowMs
        ) {
          await db.exec("COMMIT");
          return {
            acquired: false,
            ownerSessionId,
            expiresAt: expiresAtRaw,
          };
        }
      }

      await db.run(
        [
          "INSERT INTO project_locks (project_id, session_id, actor_id, chat_id, expires_at, created_at, updated_at)",
          "VALUES (?, ?, ?, ?, ?, ?, ?)",
          "ON CONFLICT(project_id) DO UPDATE SET",
          "session_id = excluded.session_id, actor_id = excluded.actor_id, chat_id = excluded.chat_id,",
          "expires_at = excluded.expires_at, updated_at = excluded.updated_at",
        ].join(" "),
        request.projectId,
        request.sessionId,
        request.actorId,
        request.chatId ?? null,
        expiresAt,
        nowIso,
        nowIso,
      );

      await db.exec("COMMIT");
      return {
        acquired: true,
        ownerSessionId: request.sessionId,
        expiresAt,
      };
    } catch (error) {
      await db.exec("ROLLBACK");
      throw error;
    }
  }

  private async getDb(): Promise<
    Database<sqlite3.Database, sqlite3.Statement>
  > {
    if (!this.dbPromise) {
      this.dbPromise = this.createDb();
    }
    return this.dbPromise;
  }

  private async createDb(): Promise<
    Database<sqlite3.Database, sqlite3.Statement>
  > {
    await mkdir(path.dirname(this.dbPath), { recursive: true });
    const db = await open({
      filename: this.dbPath,
      driver: sqlite3.Database,
    });
    await db.exec("PRAGMA journal_mode = WAL");
    await db.exec("PRAGMA synchronous = NORMAL");

    await db.exec(
      [
        "CREATE TABLE IF NOT EXISTS sessions (",
        "session_id TEXT PRIMARY KEY,",
        "session_token_hash TEXT UNIQUE,",
        "actor_id TEXT NOT NULL,",
        "chat_id TEXT,",
        "last_project_id TEXT,",
        "created_at TEXT NOT NULL,",
        "updated_at TEXT NOT NULL",
        ")",
        ";",
        "CREATE TABLE IF NOT EXISTS plans (",
        "plan_id TEXT PRIMARY KEY,",
        "session_id TEXT NOT NULL,",
        "actor_id TEXT NOT NULL,",
        "chat_id TEXT,",
        "project_id TEXT NOT NULL,",
        "adapter_id TEXT NOT NULL,",
        "user_comment TEXT,",
        "status TEXT NOT NULL,",
        "decision TEXT NOT NULL,",
        "decision_reason TEXT,",
        "approval_reasoning TEXT,",
        "baseline_hash TEXT NOT NULL,",
        "candidate_hash TEXT NOT NULL,",
        "operations_json TEXT NOT NULL,",
        "mcp_call_json TEXT,",
        "gates_json TEXT NOT NULL,",
        "risk_json TEXT NOT NULL,",
        "diff_json TEXT NOT NULL,",
        "policy_violations_json TEXT NOT NULL,",
        "validation_json TEXT NOT NULL,",
        "created_at TEXT NOT NULL,",
        "decided_at TEXT,",
        "applied_at TEXT,",
        "FOREIGN KEY(session_id) REFERENCES sessions(session_id)",
        ")",
        ";",
        "CREATE INDEX IF NOT EXISTS idx_plans_session_created ON plans(session_id, created_at DESC)",
        ";",
        "CREATE TABLE IF NOT EXISTS plan_events (",
        "event_id TEXT PRIMARY KEY,",
        "plan_id TEXT NOT NULL,",
        "session_id TEXT NOT NULL,",
        "event_type TEXT NOT NULL,",
        "payload_json TEXT NOT NULL,",
        "created_at TEXT NOT NULL,",
        "FOREIGN KEY(plan_id) REFERENCES plans(plan_id),",
        "FOREIGN KEY(session_id) REFERENCES sessions(session_id)",
        ")",
        ";",
        "CREATE INDEX IF NOT EXISTS idx_plan_events_plan_created ON plan_events(plan_id, created_at ASC)",
        ";",
        "CREATE TABLE IF NOT EXISTS project_locks (",
        "project_id TEXT PRIMARY KEY,",
        "session_id TEXT NOT NULL,",
        "actor_id TEXT NOT NULL,",
        "chat_id TEXT,",
        "expires_at TEXT NOT NULL,",
        "created_at TEXT NOT NULL,",
        "updated_at TEXT NOT NULL",
        ")",
        ";",
      ].join(" "),
    );

    try {
      await db.exec("ALTER TABLE plans ADD COLUMN approval_reasoning TEXT");
    } catch {
      // Spalte existiert
    }

    try {
      await db.exec("ALTER TABLE plans ADD COLUMN mcp_call_json TEXT");
    } catch {
      // Spalte existiert
    }

    return db;
  }
}

const readDbText = (value: unknown): string => {
  return typeof value === "string" ? value : "";
};

const readOptionalDbText = (value: unknown): string | undefined => {
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const parseJsonObject = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "string") {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const parseJsonArray = (value: unknown): unknown[] => {
  if (typeof value !== "string") {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const PLAN_STATUSES: readonly PlanRecord["status"][] = [
  "preflighted",
  "approved",
  "blocked",
  "rejected",
  "applied",
  "apply_failed",
];
const PLAN_DECISIONS: readonly PlanRecord["decision"][] = [
  "not_evaluated",
  "approved",
  "blocked",
  "rejected",
];
const PLAN_EVENT_TYPES: readonly PlanEvent["eventType"][] = [
  "preflight",
  "decision",
  "apply_success",
  "apply_failure",
  "note",
];

const isOneOf = <T extends string>(
  value: string,
  allowed: readonly T[],
): value is T => {
  return allowed.some((entry) => entry === value);
};

const readPlanStatus = (value: unknown): PlanRecord["status"] => {
  const text = readDbText(value);
  return isOneOf(text, PLAN_STATUSES) ? text : "preflighted";
};

const readPlanDecision = (value: unknown): PlanRecord["decision"] => {
  const text = readDbText(value);
  return isOneOf(text, PLAN_DECISIONS) ? text : "not_evaluated";
};

const readPlanEventType = (value: unknown): PlanEvent["eventType"] => {
  const text = readDbText(value);
  return isOneOf(text, PLAN_EVENT_TYPES) ? text : "note";
};

const decodePlanRow = (row: SqliteRow): PlanRecord => {
  const validation = parseJsonObject(row.validation_json);
  const risk = parseJsonObject(row.risk_json);
  const diff = parseJsonObject(row.diff_json);
  const gates = parseJsonArray(row.gates_json);
  const operations = parseJsonArray(row.operations_json);
  const policyViolations = parseJsonArray(row.policy_violations_json);
  const mcpCallRaw =
    typeof row.mcp_call_json === "string" && row.mcp_call_json.length > 0
      ? parseJsonObject(row.mcp_call_json)
      : undefined;
  const mcpCall =
    mcpCallRaw &&
    typeof mcpCallRaw.name === "string" &&
    isRecord(mcpCallRaw.args)
      ? { name: mcpCallRaw.name, args: mcpCallRaw.args }
      : undefined;

  return {
    planId: readDbText(row.plan_id),
    sessionId: readDbText(row.session_id),
    actorId: readDbText(row.actor_id),
    chatId: readOptionalDbText(row.chat_id),
    projectId: readDbText(row.project_id),
    adapterId: readDbText(row.adapter_id),
    userComment: readOptionalDbText(row.user_comment),
    status: readPlanStatus(row.status),
    decision: readPlanDecision(row.decision),
    decisionReason: readOptionalDbText(row.decision_reason),
    approvalReasoning: readOptionalDbText(row.approval_reasoning),
    baselineHash: readDbText(row.baseline_hash),
    candidateHash: readDbText(row.candidate_hash),
    operations: operations as PlanRecord["operations"],
    ...(mcpCall ? { mcpCall } : {}),
    gates: gates as PlanRecord["gates"],
    risk: decodeRiskResult(risk),
    diff: decodeDiffResult(diff),
    policyViolations: policyViolations.filter(
      (value): value is string => typeof value === "string",
    ),
    validation: decodeValidationResult(validation),
    createdAt: readDbText(row.created_at),
    decidedAt: readOptionalDbText(row.decided_at),
    appliedAt: readOptionalDbText(row.applied_at),
  };
};

const decodePlanEventRow = (row: SqliteRow): PlanEvent => {
  return {
    eventId: readDbText(row.event_id),
    planId: readDbText(row.plan_id),
    sessionId: readDbText(row.session_id),
    eventType: readPlanEventType(row.event_type),
    payload: parseJsonObject(row.payload_json),
    createdAt: readDbText(row.created_at),
  };
};

const decodeRiskResult = (value: Record<string, unknown>): RiskResult => {
  const levelRaw = readDbText(value.level);
  const level: RiskResult["level"] =
    levelRaw === "low" || levelRaw === "medium" || levelRaw === "high"
      ? levelRaw
      : "low";
  return {
    level,
    score: typeof value.score === "number" ? value.score : 0,
    tags: Array.isArray(value.tags) ? value.tags.filter(isRiskTag) : [],
    reasons: Array.isArray(value.reasons)
      ? value.reasons.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
    requiresApproval: value.requiresApproval === true,
  };
};

const decodeDiffResult = (value: Record<string, unknown>): DiffResult => {
  const before = value.before;
  const after = value.after;
  const delta = value.delta;
  const strings = (raw: unknown): string[] =>
    Array.isArray(raw)
      ? raw.filter((entry): entry is string => typeof entry === "string")
      : [];

  const result: DiffResult = {
    before:
      typeof before === "object" && before !== null
        ? (before as Record<string, unknown>)
        : {},
    after:
      typeof after === "object" && after !== null
        ? (after as Record<string, unknown>)
        : {},
    delta:
      typeof delta === "object" && delta !== null
        ? (delta as Record<string, number>)
        : {},
    operationKinds: strings(value.operationKinds),
    affectedObjects: strings(value.affectedObjects),
    externalEndpoints: strings(value.externalEndpoints),
  };
  if (typeof value.diffSummary === "string")
    result.diffSummary = value.diffSummary;
  if (
    typeof value.structuralDiff === "object" &&
    value.structuralDiff !== null
  ) {
    result.structuralDiff =
      value.structuralDiff as DiffResult["structuralDiff"];
  }
  return result;
};

const isValidationWarning = (value: unknown): value is ValidationWarning => {
  if (!isRecord(value)) return false;
  if (typeof value.message !== "string") return false;
  if (
    value.severity !== "low" &&
    value.severity !== "medium" &&
    value.severity !== "high"
  ) {
    return false;
  }
  if (typeof value.kind !== "string") return false;
  return true;
};

const decodeValidationResult = (
  value: Record<string, unknown>,
): ValidationResult => {
  const errors = Array.isArray(value.errors)
    ? value.errors.filter((entry): entry is string => typeof entry === "string")
    : [];
  const warnings = Array.isArray(value.warnings)
    ? value.warnings.filter(isValidationWarning)
    : [];
  return {
    passed: value.passed === true && errors.length === 0,
    errors,
    warnings,
  };
};
