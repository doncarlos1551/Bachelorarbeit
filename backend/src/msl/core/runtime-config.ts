import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { isNonEmptyString, isRecord } from "src/shared/utils";
import {
  type MslRuntimeConfigPatch,
  type RuntimeConfigFile,
  applyRuntimePatch,
  normalizeRuntimePatch,
} from "src/msl/config";
import { OPEN_PLAN_STATUSES } from "src/msl/utils";
import type { MslCore } from "src/msl/core/core";

export const loadRuntimeConfigFromDisk = (core: MslCore): void => {
  try {
    const raw = readFileSync(core.runtimeConfigPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return;
    }
    const patch = isRecord(parsed.patch)
      ? normalizeRuntimePatch(parsed.patch)
      : undefined;
    if (!patch) {
      return;
    }
    applyRuntimePatch(core.config, patch);
    core.runtimeConfigUpdatedAt = isNonEmptyString(parsed.updatedAt)
      ? parsed.updatedAt
      : undefined;
    core.runtimeConfigUpdatedBy = isNonEmptyString(parsed.updatedBy)
      ? parsed.updatedBy
      : undefined;
  } catch {
    // Fallback auf EnvConfig wenn Datei fehlt oder kaputt
  }
};

export const updateRuntimeConfig = async (
  core: MslCore,
  input: {
    patch: MslRuntimeConfigPatch;
    updatedBy?: string;
  },
): Promise<Record<string, unknown>> => {
  const patch = normalizeRuntimePatch(input.patch);
  applyRuntimePatch(core.config, patch);
  const updatedAt = new Date().toISOString();
  core.runtimeConfigUpdatedAt = updatedAt;
  core.runtimeConfigUpdatedBy = input.updatedBy;

  const payload: RuntimeConfigFile = {
    version: 1,
    updatedAt,
    updatedBy: input.updatedBy,
    patch,
  };
  await mkdir(core.config.dataDir, { recursive: true });
  await writeFile(
    core.runtimeConfigPath,
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );

  return {
    updatedAt,
    updatedBy: input.updatedBy,
    patch,
    effective: getRuntimeInfo(core),
  };
};

export const getRuntimeInfo = (core: MslCore): Record<string, unknown> => {
  // observe-only Gates loggen nur, blockieren nicht (Saltzer und Schroeder 1975, Complete Mediation)
  const warnings: string[] = [];
  const modes = core.config.gateModes;
  const observeOnlyGates = Object.entries(modes)
    .filter(([, mode]) => mode === "observe")
    .map(([gate]) => gate);
  const enforceGates = Object.entries(modes)
    .filter(([, mode]) => mode === "enforce")
    .map(([gate]) => gate);
  if (observeOnlyGates.length > 0 && enforceGates.length === 0) {
    warnings.push(
      `WARNUNG: Alle aktiven Gates (${observeOnlyGates.join(", ")}) sind im observe-Modus. ` +
        `Operationen werden NICHT blockiert, nur geloggt. ` +
        `Für aktiven Schutz mindestens risk und approval auf 'enforce' setzen.`,
    );
  }
  if (modes.approval === "off" || modes.approval === "observe") {
    warnings.push(
      `HINWEIS: Approval-Gate ist '${modes.approval}'. Gefährliche Operationen werden NICHT blockiert, ` +
        `auch wenn Risk-Scoring sie als medium/high einstuft.`,
    );
  }
  if (
    core.config.preflightRateLimit.maxSameToolCalls <= 0 &&
    modes.preflight !== "off"
  ) {
    warnings.push(
      `HINWEIS: Preflight-Rate-Limit ist deaktiviert (maxSameToolCalls=0). Einzelcall-Bursts des LLMs werden nicht mehr vom Preflight-Gate abgefangen.`,
    );
  }

  return {
    runtimeConfigPath: core.runtimeConfigPath,
    runtimeConfigUpdatedAt: core.runtimeConfigUpdatedAt,
    runtimeConfigUpdatedBy: core.runtimeConfigUpdatedBy,
    enabled: core.config.enabled,
    executionMode: core.config.executionMode,
    openPlanMode: core.config.openPlanMode,
    maxOpenPlansPerSession: core.config.maxOpenPlansPerSession,
    openPlanScanLimit: core.config.openPlanScanLimit,
    openPlanStatuses: OPEN_PLAN_STATUSES,
    approvalRiskThreshold: core.config.approvalRiskThreshold,
    gateModes: core.config.gateModes,
    projectLockMode: core.config.projectLockMode,
    projectLockTtlSeconds: core.config.projectLockTtlSeconds,
    preflightRateLimit: core.config.preflightRateLimit,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
};
