import path from "node:path";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import sqlite3 from "sqlite3";
import { open, type Database } from "sqlite";
import type {
  StudySession,
  StudyCaseRun,
  StudyResponse,
  StudyGateEvent,
  ParticipantGroup,
  MslVariant,
  StudySessionStatus,
  CaseStatus,
} from "src/study/domain";

type SqliteRow = Record<string, unknown>;

export class StudyStore {
  private readonly dbPath: string;
  private dbPromise:
    | Promise<Database<sqlite3.Database, sqlite3.Statement>>
    | undefined;

  constructor(dataDir: string) {
    this.dbPath = path.join(dataDir, "msl-study.db");
  }

  // === Study Sessions ===

  async createSession(input: {
    participantId: string;
    participantGroup: ParticipantGroup;
    counterbalanceDesignId: string;
    mslVariant: MslVariant;
    caseSequence: string[];
    mslSessionId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<StudySession> {
    const db = await this.getDb();
    const now = new Date().toISOString();
    const studySessionId = `study_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;

    const session: StudySession = {
      studySessionId,
      participantId: input.participantId,
      participantGroup: input.participantGroup,
      counterbalanceDesignId: input.counterbalanceDesignId,
      mslVariant: input.mslVariant,
      status: "active",
      mslSessionId: input.mslSessionId,
      caseSequence: input.caseSequence,
      currentCaseIndex: 0,
      metadata: input.metadata,
      startedAt: now,
    };

    await db.run(
      `INSERT INTO study_sessions (
        study_session_id, participant_id, participant_group, counterbalance_design_id,
        msl_variant, status, msl_session_id, case_sequence_json, current_case_index,
        metadata_json, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      session.studySessionId,
      session.participantId,
      session.participantGroup,
      session.counterbalanceDesignId,
      session.mslVariant,
      session.status,
      session.mslSessionId ?? null,
      JSON.stringify(session.caseSequence),
      session.currentCaseIndex,
      session.metadata ? JSON.stringify(session.metadata) : null,
      session.startedAt,
      null,
    );

    return session;
  }

  async getSession(studySessionId: string): Promise<StudySession | undefined> {
    const db = await this.getDb();
    const row = (await db.get(
      "SELECT * FROM study_sessions WHERE study_session_id = ?",
      studySessionId,
    )) as SqliteRow | undefined;
    return row ? decodeSessionRow(row) : undefined;
  }

  async listSessions(limit = 50): Promise<StudySession[]> {
    const db = await this.getDb();
    const rows = (await db.all(
      "SELECT * FROM study_sessions ORDER BY started_at DESC LIMIT ?",
      limit,
    )) as SqliteRow[];
    return rows.map(decodeSessionRow);
  }

  async updateSession(
    studySessionId: string,
    update: {
      status?: StudySessionStatus;
      currentCaseIndex?: number;
      mslSessionId?: string;
      completedAt?: string;
    },
  ): Promise<void> {
    const db = await this.getDb();
    const sets: string[] = [];
    const values: unknown[] = [];

    if (update.status !== undefined) {
      sets.push("status = ?");
      values.push(update.status);
    }
    if (update.currentCaseIndex !== undefined) {
      sets.push("current_case_index = ?");
      values.push(update.currentCaseIndex);
    }
    if (update.mslSessionId !== undefined) {
      sets.push("msl_session_id = ?");
      values.push(update.mslSessionId);
    }
    if (update.completedAt !== undefined) {
      sets.push("completed_at = ?");
      values.push(update.completedAt);
    }

    if (sets.length === 0) return;
    values.push(studySessionId);
    await db.run(
      `UPDATE study_sessions SET ${sets.join(", ")} WHERE study_session_id = ?`,
      ...values,
    );
  }

  // === Case Runs ===

  async createCaseRun(input: {
    studySessionId: string;
    caseId: string;
    variant: MslVariant;
    projectId?: string;
  }): Promise<StudyCaseRun> {
    const db = await this.getDb();
    const now = new Date().toISOString();
    const caseRunId = `run_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;

    const run: StudyCaseRun = {
      caseRunId,
      studySessionId: input.studySessionId,
      caseId: input.caseId,
      variant: input.variant,
      status: "active",
      projectId: input.projectId,
      planIds: [],
      gateEvents: [],
      startedAt: now,
    };

    await db.run(
      `INSERT INTO study_case_runs (
        case_run_id, study_session_id, case_id, variant, status, project_id,
        plan_ids_json, gate_events_json, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      run.caseRunId,
      run.studySessionId,
      run.caseId,
      run.variant,
      run.status,
      run.projectId ?? null,
      JSON.stringify(run.planIds),
      JSON.stringify(run.gateEvents),
      run.startedAt,
      null,
    );

    return run;
  }

  async getCaseRun(caseRunId: string): Promise<StudyCaseRun | undefined> {
    const db = await this.getDb();
    const row = (await db.get(
      "SELECT * FROM study_case_runs WHERE case_run_id = ?",
      caseRunId,
    )) as SqliteRow | undefined;
    return row ? decodeCaseRunRow(row) : undefined;
  }

  async listCaseRuns(studySessionId: string): Promise<StudyCaseRun[]> {
    const db = await this.getDb();
    const rows = (await db.all(
      "SELECT * FROM study_case_runs WHERE study_session_id = ? ORDER BY started_at ASC",
      studySessionId,
    )) as SqliteRow[];
    return rows.map(decodeCaseRunRow);
  }

  async updateCaseRun(
    caseRunId: string,
    update: {
      status?: CaseStatus;
      projectId?: string;
      planIds?: string[];
      gateEvents?: StudyGateEvent[];
      completedAt?: string;
    },
  ): Promise<void> {
    const db = await this.getDb();
    const sets: string[] = [];
    const values: unknown[] = [];

    if (update.status !== undefined) {
      sets.push("status = ?");
      values.push(update.status);
    }
    if (update.projectId !== undefined) {
      sets.push("project_id = ?");
      values.push(update.projectId);
    }
    if (update.planIds !== undefined) {
      sets.push("plan_ids_json = ?");
      values.push(JSON.stringify(update.planIds));
    }
    if (update.gateEvents !== undefined) {
      sets.push("gate_events_json = ?");
      values.push(JSON.stringify(update.gateEvents));
    }
    if (update.completedAt !== undefined) {
      sets.push("completed_at = ?");
      values.push(update.completedAt);
    }

    if (sets.length === 0) return;
    values.push(caseRunId);
    await db.run(
      `UPDATE study_case_runs SET ${sets.join(", ")} WHERE case_run_id = ?`,
      ...values,
    );
  }

  async appendPlanId(caseRunId: string, planId: string): Promise<void> {
    const run = await this.getCaseRun(caseRunId);
    if (!run) return;
    const planIds = [...run.planIds, planId];
    await this.updateCaseRun(caseRunId, { planIds });
  }

  async appendGateEvent(
    caseRunId: string,
    event: StudyGateEvent,
  ): Promise<void> {
    const run = await this.getCaseRun(caseRunId);
    if (!run) return;
    const gateEvents = [...run.gateEvents, event];
    await this.updateCaseRun(caseRunId, { gateEvents });
  }

  // === Responses ===

  async createResponse(input: {
    studySessionId: string;
    caseRunId: string;
    caseId: string;
    variant: MslVariant;
    decision?: "approve" | "reject";
    correct?: boolean;
    decisionTimeMs?: number;
    trustRating?: number;
    confidenceRating?: number;
    transparencyRating?: number;
    controlRating?: number;
    notes?: string;
    additionalItems?: Record<string, unknown>;
  }): Promise<StudyResponse> {
    const db = await this.getDb();
    const now = new Date().toISOString();
    const responseId = `resp_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;

    const response: StudyResponse = {
      responseId,
      studySessionId: input.studySessionId,
      caseRunId: input.caseRunId,
      caseId: input.caseId,
      variant: input.variant,
      decision: input.decision,
      correct: input.correct,
      decisionTimeMs: input.decisionTimeMs,
      trustRating: input.trustRating,
      confidenceRating: input.confidenceRating,
      transparencyRating: input.transparencyRating,
      controlRating: input.controlRating,
      notes: input.notes,
      additionalItems: input.additionalItems,
      createdAt: now,
    };

    await db.run(
      `INSERT INTO study_responses (
        response_id, study_session_id, case_run_id, case_id, variant,
        decision, correct, decision_time_ms,
        trust_rating, confidence_rating, transparency_rating, control_rating,
        notes, additional_items_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      response.responseId,
      response.studySessionId,
      response.caseRunId,
      response.caseId,
      response.variant,
      response.decision ?? null,
      response.correct != null ? (response.correct ? 1 : 0) : null,
      response.decisionTimeMs ?? null,
      response.trustRating ?? null,
      response.confidenceRating ?? null,
      response.transparencyRating ?? null,
      response.controlRating ?? null,
      response.notes ?? null,
      response.additionalItems
        ? JSON.stringify(response.additionalItems)
        : null,
      response.createdAt,
    );

    return response;
  }

  async listResponses(studySessionId: string): Promise<StudyResponse[]> {
    const db = await this.getDb();
    const rows = (await db.all(
      "SELECT * FROM study_responses WHERE study_session_id = ? ORDER BY created_at ASC",
      studySessionId,
    )) as SqliteRow[];
    return rows.map(decodeResponseRow);
  }

  async listAllResponses(limit = 500): Promise<StudyResponse[]> {
    const db = await this.getDb();
    const rows = (await db.all(
      "SELECT * FROM study_responses ORDER BY created_at DESC LIMIT ?",
      limit,
    )) as SqliteRow[];
    return rows.map(decodeResponseRow);
  }

  // === DB Init ===

  private async getDb(): Promise<
    Database<sqlite3.Database, sqlite3.Statement>
  > {
    if (!this.dbPromise) {
      this.dbPromise = this.initDb();
    }
    return this.dbPromise;
  }

  private async initDb(): Promise<
    Database<sqlite3.Database, sqlite3.Statement>
  > {
    await mkdir(path.dirname(this.dbPath), { recursive: true });
    const db = await open({ filename: this.dbPath, driver: sqlite3.Database });

    await db.exec(`PRAGMA foreign_keys = ON;`);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS study_sessions (
        study_session_id TEXT PRIMARY KEY,
        participant_id TEXT NOT NULL,
        participant_group TEXT NOT NULL,
        counterbalance_design_id TEXT NOT NULL,
        msl_variant TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        msl_session_id TEXT,
        case_sequence_json TEXT NOT NULL DEFAULT '[]',
        current_case_index INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_study_sessions_participant
        ON study_sessions(participant_id);

      CREATE TABLE IF NOT EXISTS study_case_runs (
        case_run_id TEXT PRIMARY KEY,
        study_session_id TEXT NOT NULL,
        case_id TEXT NOT NULL,
        variant TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        project_id TEXT,
        plan_ids_json TEXT NOT NULL DEFAULT '[]',
        gate_events_json TEXT NOT NULL DEFAULT '[]',
        started_at TEXT,
        completed_at TEXT,
        FOREIGN KEY(study_session_id) REFERENCES study_sessions(study_session_id)
      );

      CREATE INDEX IF NOT EXISTS idx_study_case_runs_session
        ON study_case_runs(study_session_id);

      CREATE TABLE IF NOT EXISTS study_responses (
        response_id TEXT PRIMARY KEY,
        study_session_id TEXT NOT NULL,
        case_run_id TEXT NOT NULL,
        case_id TEXT NOT NULL,
        variant TEXT NOT NULL,
        decision TEXT,
        correct INTEGER,
        decision_time_ms INTEGER,
        trust_rating INTEGER,
        confidence_rating INTEGER,
        transparency_rating INTEGER,
        control_rating INTEGER,
        notes TEXT,
        additional_items_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(study_session_id) REFERENCES study_sessions(study_session_id),
        FOREIGN KEY(case_run_id) REFERENCES study_case_runs(case_run_id)
      );

      CREATE INDEX IF NOT EXISTS idx_study_responses_session
        ON study_responses(study_session_id);
    `);

    return db;
  }
}

// === Row Decoders ===

const readDbText = (v: unknown): string => (typeof v === "string" ? v : "");
const readOptionalDbText = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;
const readOptionalDbNumber = (v: unknown): number | undefined =>
  typeof v === "number" ? v : undefined;
const readOptionalDbBool = (v: unknown): boolean | undefined => {
  if (v === 1) return true;
  if (v === 0) return false;
  return undefined;
};

const PARTICIPANT_GROUPS: readonly ParticipantGroup[] = [
  "professional_dev",
  "citizen_dev",
];
const MSL_VARIANTS: readonly MslVariant[] = [
  "baseline",
  "summary",
  "diff",
  "diff_risk",
  "full",
];
const SESSION_STATUSES: readonly StudySessionStatus[] = [
  "active",
  "completed",
  "aborted",
];
const CASE_STATUSES: readonly CaseStatus[] = [
  "pending",
  "active",
  "completed",
  "skipped",
];
const RESPONSE_DECISIONS: readonly NonNullable<StudyResponse["decision"]>[] = [
  "approve",
  "reject",
];

const isOneOf = <T extends string>(
  value: string,
  allowed: readonly T[],
): value is T => {
  return allowed.some((entry) => entry === value);
};

const parseJsonValue = (v: unknown): unknown => {
  if (typeof v !== "string") return undefined;
  try {
    return JSON.parse(v);
  } catch {
    return undefined;
  }
};

const isDbRecord = (v: unknown): v is Record<string, unknown> => {
  return typeof v === "object" && v !== null && !Array.isArray(v);
};

const readJsonRecord = (v: unknown): Record<string, unknown> | undefined => {
  const parsed = parseJsonValue(v);
  return isDbRecord(parsed) ? parsed : undefined;
};

const readJsonStringArray = (v: unknown): string[] => {
  const parsed = parseJsonValue(v);
  return Array.isArray(parsed)
    ? parsed.filter((entry): entry is string => typeof entry === "string")
    : [];
};

const readJsonGateEvents = (v: unknown): StudyGateEvent[] => {
  const parsed = parseJsonValue(v);
  return Array.isArray(parsed) ? parsed.filter(isStudyGateEvent) : [];
};

const readParticipantGroup = (v: unknown): ParticipantGroup => {
  const value = readDbText(v);
  return isOneOf(value, PARTICIPANT_GROUPS) ? value : "citizen_dev";
};

const readMslVariant = (v: unknown): MslVariant => {
  const value = readDbText(v);
  return isOneOf(value, MSL_VARIANTS) ? value : "diff_risk";
};

const readSessionStatus = (v: unknown): StudySessionStatus => {
  const value = readDbText(v);
  return isOneOf(value, SESSION_STATUSES) ? value : "active";
};

const readCaseStatus = (v: unknown): CaseStatus => {
  const value = readDbText(v);
  return isOneOf(value, CASE_STATUSES) ? value : "pending";
};

const readDecision = (v: unknown): StudyResponse["decision"] => {
  const value = readOptionalDbText(v);
  return value && isOneOf(value, RESPONSE_DECISIONS) ? value : undefined;
};

const isStudyGateEvent = (v: unknown): v is StudyGateEvent => {
  return (
    isDbRecord(v) &&
    typeof v.timestamp === "string" &&
    typeof v.planId === "string" &&
    typeof v.gate === "string" &&
    typeof v.mode === "string" &&
    typeof v.passed === "boolean" &&
    typeof v.blocked === "boolean"
  );
};

const decodeSessionRow = (row: SqliteRow): StudySession => ({
  studySessionId: readDbText(row.study_session_id),
  participantId: readDbText(row.participant_id),
  participantGroup: readParticipantGroup(row.participant_group),
  counterbalanceDesignId: readDbText(row.counterbalance_design_id),
  mslVariant: readMslVariant(row.msl_variant),
  status: readSessionStatus(row.status),
  mslSessionId: readOptionalDbText(row.msl_session_id),
  caseSequence: readJsonStringArray(row.case_sequence_json),
  currentCaseIndex:
    typeof row.current_case_index === "number" ? row.current_case_index : 0,
  metadata: readJsonRecord(row.metadata_json),
  startedAt: readDbText(row.started_at),
  completedAt: readOptionalDbText(row.completed_at),
});

const decodeCaseRunRow = (row: SqliteRow): StudyCaseRun => ({
  caseRunId: readDbText(row.case_run_id),
  studySessionId: readDbText(row.study_session_id),
  caseId: readDbText(row.case_id),
  variant: readMslVariant(row.variant),
  status: readCaseStatus(row.status),
  projectId: readOptionalDbText(row.project_id),
  planIds: readJsonStringArray(row.plan_ids_json),
  gateEvents: readJsonGateEvents(row.gate_events_json),
  startedAt: readOptionalDbText(row.started_at),
  completedAt: readOptionalDbText(row.completed_at),
});

const decodeResponseRow = (row: SqliteRow): StudyResponse => ({
  responseId: readDbText(row.response_id),
  studySessionId: readDbText(row.study_session_id),
  caseRunId: readDbText(row.case_run_id),
  caseId: readDbText(row.case_id),
  variant: readMslVariant(row.variant),
  decision: readDecision(row.decision),
  correct: readOptionalDbBool(row.correct),
  decisionTimeMs: readOptionalDbNumber(row.decision_time_ms),
  trustRating: readOptionalDbNumber(row.trust_rating),
  confidenceRating: readOptionalDbNumber(row.confidence_rating),
  transparencyRating: readOptionalDbNumber(row.transparency_rating),
  controlRating: readOptionalDbNumber(row.control_rating),
  notes: readOptionalDbText(row.notes),
  additionalItems: readJsonRecord(row.additional_items_json),
  createdAt: readDbText(row.created_at),
});
