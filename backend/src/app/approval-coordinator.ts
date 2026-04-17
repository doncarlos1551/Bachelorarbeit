import type { MslCore } from "src/msl/core";

// === Approval Coordinator ===
// Pollt den Plan-Status bis User-Entscheidung oder Timeout
// - approved -> Caller löst Apply aus
// - applied -> ein anderer Pfad hat schon appliziert (Race-Condition, idempotent)
// - rejected -> Caller wirft MslRejectionError
// - timeout  -> Caller markiert Plan als rejected und wirft MslRejectionError
// Coordinator kennt weder Apply noch Backplane-Events nur Plan-Polling

export type ApprovalDecision = "approved" | "applied" | "rejected" | "timeout";

export interface ApprovalAwaitOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

const APPROVAL_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 1_500;

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export class ApprovalCoordinator {
  constructor(private readonly msl: MslCore) {}

  async awaitDecision(
    planId: string,
    options: ApprovalAwaitOptions = {},
  ): Promise<ApprovalDecision> {
    const timeoutMs = options.timeoutMs ?? APPROVAL_TIMEOUT_MS;
    const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await sleep(pollIntervalMs);
      const currentPlan = await this.msl.getPlan(planId);
      if (!currentPlan) return "rejected";
      if (currentPlan.status === "applied") return "applied";
      if (currentPlan.status === "approved") return "approved";
      if (currentPlan.status === "rejected") return "rejected";
    }
    return "timeout";
  }
}
