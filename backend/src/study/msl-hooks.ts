import type { MslRuntimeConfigPatch } from "src/msl/config";

// === StudyMslHooks ===
// Schmaler MSL-Zugriff für Study-Router
// - updateBackplaneConfig: Variant-Gate-Config beim Start
// - cleanupOpenPlans: Session-Boundary (alter raus, neuer rein)
// - getSessionQueue: Plan-Anzeige in Session-Antwort
// BaselineService erfüllt strukturell -> kein Wrapper
export interface StudyMslHooks {
  updateBackplaneConfig(input: {
    patch: MslRuntimeConfigPatch;
    actorId?: string;
  }): Promise<Record<string, unknown>>;

  cleanupOpenPlans(input: {
    scope: "all" | "session";
    sessionId?: string;
    reason?: string;
  }): Promise<{ rejectedCount: number }>;

  getSessionQueue(input: {
    sessionId: string;
    limit?: number;
  }): Promise<Record<string, unknown>>;
}
