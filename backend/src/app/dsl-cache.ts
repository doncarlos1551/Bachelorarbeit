import type { JsonRecord } from "src/shared/utils";

// === DSL Cache ===
// Letzter Write pro Projekt mit TTL 30s
// Spart Lowcoder-GET nach saveApplication
// Caller muss nach Write set() rufen sonst verfällt
const DSL_CACHE_TTL_MS = 30_000;

interface DslCacheEntry {
  dsl: JsonRecord;
  writtenAt: number;
}

export class DslCache {
  private readonly entries = new Map<string, DslCacheEntry>();

  get(projectId: string): JsonRecord | undefined {
    const cached = this.entries.get(projectId);
    if (!cached) return undefined;
    if (Date.now() - cached.writtenAt >= DSL_CACHE_TTL_MS) {
      this.entries.delete(projectId);
      return undefined;
    }
    return structuredClone(cached.dsl);
  }

  set(projectId: string, dsl: JsonRecord): void {
    this.entries.set(projectId, {
      dsl: structuredClone(dsl),
      writtenAt: Date.now(),
    });
  }
}
