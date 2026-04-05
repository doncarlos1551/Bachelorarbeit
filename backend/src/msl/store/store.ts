import path from "node:path";
import { randomUUID } from "node:crypto";
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
import { readPositiveInt } from "src/shared/utils";
import { SqliteMslStore } from "src/msl/store/store-sqlite";
import { hashSessionToken } from "src/msl/utils";

interface StoreConfig {
  backend: "memory" | "sqlite";
  sqlitePath: string;
  defaultProjectLockTtlSeconds: number;
}

export const readStoreConfigFromEnv = (): StoreConfig => {
  const backendRaw = readEnvString(process.env.MSL_STORE_BACKEND, "sqlite")
    .trim()
    .toLowerCase();
  const backend: StoreConfig["backend"] =
    backendRaw === "memory" ? "memory" : "sqlite";
  const configuredSqlitePath =
    process.env.MSL_SQLITE_PATH ?? path.join(".msl-data", "msl.sqlite");
  const sqlitePath = path.isAbsolute(configuredSqlitePath)
    ? configuredSqlitePath
    : path.resolve(process.cwd(), configuredSqlitePath);

  return {
    backend,
    sqlitePath,
    defaultProjectLockTtlSeconds: readPositiveInt(
      process.env.MSL_PROJECT_LOCK_TTL_SECONDS,
      3600,
    ),
  };
};

const readEnvString = (value: unknown, fallback: string): string => {
  return typeof value === "string" ? value : fallback;
};

export const createMslStore = (): MslStore => {
  const config = readStoreConfigFromEnv();
  if (config.backend === "memory") {
    return new InMemoryMslStore(config.defaultProjectLockTtlSeconds);
  }
  return new SqliteMslStore(
    config.sqlitePath,
    config.defaultProjectLockTtlSeconds,
  );
};

type LockRecord = {
  sessionId: string;
  expiresAt: string;
};

class InMemoryMslStore implements MslStore {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly sessionsByTokenHash = new Map<string, string>();
  private readonly plans = new Map<string, PlanRecord>();
  private readonly planEvents = new Map<string, PlanEvent[]>();
  private readonly projectLocks = new Map<string, LockRecord>();
  private readonly defaultProjectLockTtlSeconds: number;

  constructor(defaultProjectLockTtlSeconds: number) {
    this.defaultProjectLockTtlSeconds = defaultProjectLockTtlSeconds;
  }

  async ensureSession(input: EnsureSessionInput): Promise<SessionRecord> {
    const now = new Date().toISOString();
    const tokenHash = hashSessionToken(input.sessionToken);
    const requestedSessionId = input.sessionId?.trim();

    let existing: SessionRecord | undefined;
    if (requestedSessionId) {
      existing = this.sessions.get(requestedSessionId);
    } else if (tokenHash) {
      const mappedSessionId = this.sessionsByTokenHash.get(tokenHash);
      if (mappedSessionId) {
        existing = this.sessions.get(mappedSessionId);
      }
    }

    if (existing) {
      const updated: SessionRecord = {
        ...existing,
        actorId: input.actorId || existing.actorId,
        chatId: input.chatId ?? existing.chatId,
        lastProjectId: input.projectId ?? existing.lastProjectId,
        updatedAt: now,
      };
      this.sessions.set(updated.sessionId, updated);
      if (tokenHash) {
        this.sessionsByTokenHash.set(tokenHash, updated.sessionId);
      }
      return structuredClone(updated);
    }

    const sessionId =
      requestedSessionId || `sess_${randomUUID().replace(/-/g, "")}`;
    const created: SessionRecord = {
      sessionId,
      sessionTokenHash: tokenHash,
      actorId: input.actorId,
      chatId: input.chatId,
      lastProjectId: input.projectId,
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(sessionId, created);
    if (tokenHash) {
      this.sessionsByTokenHash.set(tokenHash, sessionId);
    }
    return structuredClone(created);
  }

  async createPlan(record: PlanRecord): Promise<void> {
    this.plans.set(record.planId, structuredClone(record));
  }

  async appendPlanEvent(event: PlanEvent): Promise<void> {
    const list = this.planEvents.get(event.planId) ?? [];
    list.push(structuredClone(event));
    this.planEvents.set(event.planId, list);
  }

  async updatePlan(planId: string, update: PlanUpdate): Promise<void> {
    const current = this.plans.get(planId);
    if (!current) {
      return;
    }
    const next: PlanRecord = {
      ...current,
      status: update.status ?? current.status,
      decision: update.decision ?? current.decision,
      decisionReason: update.decisionReason ?? current.decisionReason,
      approvalReasoning: update.approvalReasoning ?? current.approvalReasoning,
      decidedAt: update.decidedAt ?? current.decidedAt,
      appliedAt: update.appliedAt ?? current.appliedAt,
    };
    this.plans.set(planId, next);
  }

  async getPlan(planId: string): Promise<PlanRecord | undefined> {
    const value = this.plans.get(planId);
    return value ? structuredClone(value) : undefined;
  }

  async listPlansBySession(filter: PlanListFilter): Promise<PlanRecord[]> {
    const list: PlanRecord[] = [];
    for (const plan of this.plans.values()) {
      if (plan.sessionId === filter.sessionId) {
        list.push(structuredClone(plan));
      }
    }
    list.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return list.slice(0, filter.limit);
  }

  async listPlans(limit: number): Promise<PlanRecord[]> {
    const list: PlanRecord[] = [];
    for (const plan of this.plans.values()) {
      list.push(structuredClone(plan));
    }
    list.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return list.slice(0, limit);
  }

  async listPlanEvents(planId: string): Promise<PlanEvent[]> {
    const list = this.planEvents.get(planId) ?? [];
    return list.map((event) => structuredClone(event));
  }

  async tryAcquireProjectLock(
    request: ProjectLockRequest,
  ): Promise<ProjectLockResult> {
    const nowMs = Date.now();
    const ttlSeconds =
      request.ttlSeconds > 0
        ? request.ttlSeconds
        : this.defaultProjectLockTtlSeconds;
    const current = this.projectLocks.get(request.projectId);
    if (current) {
      const expiresMs = Date.parse(current.expiresAt);
      if (
        Number.isFinite(expiresMs) &&
        expiresMs > nowMs &&
        current.sessionId !== request.sessionId
      ) {
        return {
          acquired: false,
          ownerSessionId: current.sessionId,
          expiresAt: current.expiresAt,
        };
      }
    }

    const expiresAt = new Date(nowMs + ttlSeconds * 1000).toISOString();
    this.projectLocks.set(request.projectId, {
      sessionId: request.sessionId,
      expiresAt,
    });
    return {
      acquired: true,
      ownerSessionId: request.sessionId,
      expiresAt,
    };
  }
}
