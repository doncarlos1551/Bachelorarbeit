import { createHash } from "node:crypto";
import { isRecord } from "src/shared/utils";
import type { PlanStatus } from "src/msl/plan/plan.interfaces";

// === MSL Utils ===

export const hashSessionToken = (token?: string): string | undefined => {
  const normalized = token?.trim();
  if (!normalized) {
    return undefined;
  }
  const hash = createHash("sha256");
  hash.update(normalized);
  return hash.digest("hex");
};

// sorgt für reproduzierbares JSON unabhängig von KeyReihenfolge
const stableSerialize = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  if (value === undefined) {
    return "null";
  }
  const raw = JSON.stringify(value);
  return raw === undefined ? "null" : raw;
};

export const hashObject = (value: unknown): string => {
  const hash = createHash("sha256");
  hash.update(stableSerialize(value));
  return hash.digest("hex");
};

// Plan-Statuse die offen sind (UserAktion noch ausstehend)
export const OPEN_PLAN_STATUSES: PlanStatus[] = [
  "preflighted",
  "approved",
  "apply_failed",
];

export const isOpenPlanStatus = (status: PlanStatus): boolean =>
  OPEN_PLAN_STATUSES.includes(status);
