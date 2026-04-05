import path from "node:path";
import type { GateMode, GateModes } from "src/msl/gates/gates.interfaces";
import { isRecord, readBoolean, readPositiveInt } from "src/shared/utils";

export interface MslPolicyConfig {
  maxOperationsPerCall: number;
  maxDeleteOperations: number;
  maxPayloadBytes: number;
  allowedKinds: string[];
  deniedKinds: string[];
  allowedExternalHosts: string[];
}

export interface MslPreflightRateLimit {
  windowSeconds: number;
  maxSameToolCalls: number;
  recommendedBatchTool: string;
}

export interface MslConfig {
  enabled: boolean;
  dataDir: string;
  sessionToken?: string;
  executionMode: "auto" | "manual";
  openPlanMode: "allow" | "block";
  maxOpenPlansPerSession: number;
  openPlanScanLimit: number;
  approvalRiskThreshold: "medium" | "high";
  gateModes: GateModes;
  projectLockMode: GateMode;
  projectLockTtlSeconds: number;
  policy: MslPolicyConfig;
  preflightRateLimit: MslPreflightRateLimit;
}

export interface MslRuntimeConfigPatch {
  executionMode?: "auto" | "manual";
  approvalRiskThreshold?: "medium" | "high";
  openPlanMode?: "allow" | "block";
  maxOpenPlansPerSession?: number;
  openPlanScanLimit?: number;
  projectLockMode?: GateMode;
  projectLockTtlSeconds?: number;
  gateModes?: Partial<GateModes>;
}

export interface RuntimeConfigFile {
  version: 1;
  updatedAt: string;
  updatedBy?: string;
  patch: MslRuntimeConfigPatch;
}

const readEnum = <T extends string>(
  raw: unknown,
  allowed: readonly T[],
  fallback: T,
): T => {
  const normalized = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  const match = allowed.find((value) => value === normalized);
  return match ?? fallback;
};

const EXECUTION_MODES: readonly MslConfig["executionMode"][] = [
  "auto",
  "manual",
];
const OPEN_PLAN_MODES: readonly MslConfig["openPlanMode"][] = [
  "allow",
  "block",
];
const RISK_THRESHOLDS: readonly MslConfig["approvalRiskThreshold"][] = [
  "medium",
  "high",
];
const GATE_MODES: readonly GateMode[] = ["off", "observe", "enforce"];
const GATE_KEYS: Array<keyof GateModes> = [
  "policy",
  "preflight",
  "diff",
  "risk",
  "validation",
  "approval",
  "audit",
];

const readExecutionMode = (raw: unknown) =>
  readEnum(raw, EXECUTION_MODES, "auto");
const readOpenPlanMode = (raw: unknown) =>
  readEnum(raw, OPEN_PLAN_MODES, "allow");
const readRiskThreshold = (raw: unknown) =>
  readEnum(raw, RISK_THRESHOLDS, "high");
export const readGateMode = (raw: unknown, fallback: GateMode): GateMode =>
  readEnum(raw, GATE_MODES, fallback);

const readCsv = (raw: string | undefined): string[] => {
  if (!raw) return [];
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
};

export const readConfigFromEnv = (): MslConfig => {
  const baseDir = process.cwd();
  const configuredDataDir = process.env.MSL_DATA_DIR ?? ".msl-data";
  const dataDir = path.isAbsolute(configuredDataDir)
    ? configuredDataDir
    : path.resolve(baseDir, configuredDataDir);

  return {
    enabled: readBoolean(process.env.MSL_CORE_ENABLED, true),
    dataDir,
    sessionToken: process.env.MSL_SESSION_TOKEN?.trim() || undefined,
    executionMode: readExecutionMode(process.env.MSL_EXECUTION_MODE),
    openPlanMode: readOpenPlanMode(process.env.MSL_OPEN_PLAN_MODE),
    maxOpenPlansPerSession: readPositiveInt(
      process.env.MSL_OPEN_PLAN_MAX_PER_SESSION,
      3,
    ),
    openPlanScanLimit: readPositiveInt(
      process.env.MSL_OPEN_PLAN_SCAN_LIMIT,
      250,
    ),
    approvalRiskThreshold: readRiskThreshold(
      process.env.MSL_APPROVAL_RISK_THRESHOLD,
    ),
    gateModes: {
      policy: readGateMode(process.env.MSL_GATE_POLICY_MODE, "observe"),
      preflight: readGateMode(process.env.MSL_GATE_PREFLIGHT_MODE, "enforce"),
      diff: readGateMode(process.env.MSL_GATE_DIFF_MODE, "observe"),
      risk: readGateMode(process.env.MSL_GATE_RISK_MODE, "observe"),
      validation: readGateMode(process.env.MSL_GATE_VALIDATION_MODE, "observe"),
      approval: readGateMode(process.env.MSL_GATE_APPROVAL_MODE, "off"),
      audit: readGateMode(process.env.MSL_GATE_AUDIT_MODE, "observe"),
    },
    projectLockMode: readGateMode(process.env.MSL_PROJECT_LOCK_MODE, "off"),
    projectLockTtlSeconds: readPositiveInt(
      process.env.MSL_PROJECT_LOCK_TTL_SECONDS,
      3600,
    ),
    policy: {
      maxOperationsPerCall: readPositiveInt(
        process.env.MSL_POLICY_MAX_OPERATIONS,
        25,
      ),
      maxDeleteOperations: readPositiveInt(
        process.env.MSL_POLICY_MAX_DELETE_OPERATIONS,
        3,
      ),
      maxPayloadBytes: readPositiveInt(
        process.env.MSL_POLICY_MAX_PAYLOAD_BYTES,
        200_000,
      ),
      allowedKinds: readCsv(process.env.MSL_POLICY_ALLOWED_KINDS),
      deniedKinds: readCsv(process.env.MSL_POLICY_DENIED_KINDS),
      allowedExternalHosts: readCsv(
        process.env.MSL_POLICY_ALLOWED_EXTERNAL_HOSTS,
      ),
    },
    preflightRateLimit: {
      windowSeconds: readPositiveInt(
        process.env.MSL_PREFLIGHT_RATE_WINDOW_SECONDS,
        60,
      ),
      // default 5 stoppt LLM-Loops früh
      // jen ach model -> bei batch-fähigen models sinnvoll niedrig sonst zu früh apply pflicht
      maxSameToolCalls: readPositiveInt(
        process.env.MSL_PREFLIGHT_RATE_MAX_SAME_TOOL,
        5,
      ),
      recommendedBatchTool: (
        process.env.MSL_PREFLIGHT_RATE_BATCH_TOOL ?? "apply_operations_batch"
      ).trim(),
    },
  };
};

export const normalizeRuntimePatch = (
  input: unknown,
): MslRuntimeConfigPatch => {
  if (!isRecord(input)) {
    throw new Error("Invalid runtime config patch.");
  }

  const patch: MslRuntimeConfigPatch = {};

  if (input.executionMode !== undefined) {
    patch.executionMode = readExecutionMode(input.executionMode);
  }
  if (input.approvalRiskThreshold !== undefined) {
    patch.approvalRiskThreshold = readRiskThreshold(
      input.approvalRiskThreshold,
    );
  }
  if (input.openPlanMode !== undefined) {
    patch.openPlanMode = readOpenPlanMode(input.openPlanMode);
  }
  if (input.maxOpenPlansPerSession !== undefined) {
    const value = Number(input.maxOpenPlansPerSession);
    if (!Number.isInteger(value) || value <= 0)
      throw new Error("maxOpenPlansPerSession must be a positive integer.");
    patch.maxOpenPlansPerSession = value;
  }
  if (input.openPlanScanLimit !== undefined) {
    const value = Number(input.openPlanScanLimit);
    if (!Number.isInteger(value) || value <= 0)
      throw new Error("openPlanScanLimit must be a positive integer.");
    patch.openPlanScanLimit = value;
  }
  if (input.projectLockMode !== undefined) {
    patch.projectLockMode = readGateMode(input.projectLockMode, "off");
  }
  if (input.projectLockTtlSeconds !== undefined) {
    const value = Number(input.projectLockTtlSeconds);
    if (!Number.isInteger(value) || value <= 0)
      throw new Error("projectLockTtlSeconds must be a positive integer.");
    patch.projectLockTtlSeconds = value;
  }
  if (input.gateModes !== undefined) {
    if (!isRecord(input.gateModes))
      throw new Error("gateModes must be an object.");
    const gatePatch: Partial<GateModes> = {};
    for (const key of GATE_KEYS) {
      if (input.gateModes[key] !== undefined) {
        gatePatch[key] = readGateMode(input.gateModes[key], "observe");
      }
    }
    patch.gateModes = gatePatch;
  }

  if (Object.keys(patch).length === 0)
    throw new Error("Runtime config patch is empty.");
  return patch;
};

export const applyRuntimePatch = (
  config: MslConfig,
  patch: MslRuntimeConfigPatch,
): void => {
  if (patch.executionMode) config.executionMode = patch.executionMode;
  if (patch.approvalRiskThreshold)
    config.approvalRiskThreshold = patch.approvalRiskThreshold;
  if (patch.openPlanMode) config.openPlanMode = patch.openPlanMode;
  if (patch.maxOpenPlansPerSession !== undefined)
    config.maxOpenPlansPerSession = patch.maxOpenPlansPerSession;
  if (patch.openPlanScanLimit !== undefined)
    config.openPlanScanLimit = patch.openPlanScanLimit;
  if (patch.projectLockMode) config.projectLockMode = patch.projectLockMode;
  if (patch.projectLockTtlSeconds !== undefined)
    config.projectLockTtlSeconds = patch.projectLockTtlSeconds;
  if (patch.gateModes) {
    config.gateModes = { ...config.gateModes, ...patch.gateModes };
  }
};
