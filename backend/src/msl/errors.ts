import type { MslPayload } from "src/msl/payload/payload.interfaces";

export class MslRejectionError extends Error {
  readonly kind = "msl_rejected" as const;
  readonly planId?: string;
  readonly riskLevel?: string;
  readonly mslPayload?: MslPayload;

  constructor(
    message: string,
    options: {
      planId?: string;
      riskLevel?: string;
      mslPayload?: MslPayload;
    } = {},
  ) {
    super(message);
    this.name = "MslRejectionError";
    this.planId = options.planId;
    this.riskLevel = options.riskLevel;
    this.mslPayload = options.mslPayload;
  }
}

export class PlanNotApprovedError extends Error {
  readonly kind = "plan_not_approved" as const;
  readonly planId: string;
  readonly status: string;

  constructor(planId: string, status: string) {
    super(`Plan '${planId}' is not approved. Current status: ${status}.`);
    this.name = "PlanNotApprovedError";
    this.planId = planId;
    this.status = status;
  }
}
