import { ZodError, type ZodIssue } from "zod";
import { serializePreview } from "src/shared/utils";
import type { MslPayload } from "src/msl/payload/payload.interfaces";
import { MslRejectionError } from "src/msl/errors";
import type {
  BaselineToolEnvelope,
  LlmToolView,
  SuccessToolData,
  ToolCode,
  ToolStatus,
} from "src/app/tool-result.interfaces";
export type {
  BaselineToolEnvelope,
  SuccessToolData,
  ToolCode,
  ToolStatus,
} from "src/app/tool-result.interfaces";

const MAX_ZOD_ISSUES_IN_MESSAGE = 5;

const formatZodIssuePath = (issue: ZodIssue): string => {
  if (issue.path.length === 0) return "(root)";
  return issue.path
    .map((segment) => (typeof segment === "number" ? `[${segment}]` : segment))
    .join(".")
    .replace(/\.\[/g, "[");
};

const formatZodErrorMessage = (error: ZodError): string => {
  const lines = error.issues
    .slice(0, MAX_ZOD_ISSUES_IN_MESSAGE)
    .map((issue) => `${formatZodIssuePath(issue)}: ${issue.message}`);
  const overflow = error.issues.length - MAX_ZOD_ISSUES_IN_MESSAGE;
  if (overflow > 0) {
    lines.push(`... und ${overflow} weitere`);
  }
  return `Tool-Parameter ungültig:\n${lines.join("\n")}`;
};

export const createSuccessToolResult = (
  tool: string,
  message: string,
  data: SuccessToolData,
  options?: { userComment?: string },
) => {
  const mode = inferMode(data);
  const msl = inferMsl(data, mode);
  const envelope: BaselineToolEnvelope = {
    ok: true,
    status: "success",
    code: "applied",
    message,
    tool,
    agent: {
      shouldAbort: false,
      nextAction: "continue",
    },
    platform: {
      adapterId: "lowcoder-api",
      mode,
    },
    msl,
    userComment: options?.userComment,
    data,
  };

  return {
    content: [
      {
        type: "text" as const,
        text: serializeLlmView(buildLlmView(envelope)),
      },
    ],
    structuredContent: envelope,
  };
};

const buildLlmView = (envelope: BaselineToolEnvelope): LlmToolView => {
  const msl = envelope.msl;
  const view: LlmToolView = {
    ok: envelope.ok,
    tool: envelope.tool,
    message: envelope.message,
    decision: msl.decision,
  };
  if (msl.requiresManualApply) view.requiresManualApply = true;
  if (msl.planId) view.planId = msl.planId;

  const changes = msl.approvalReasoningStructured?.changes ?? [];
  if (changes.length > 0) {
    // max 8 Änderungen ans LLM Rest geht über structuredContent ans Frontend
    view.changes = changes.slice(0, 8);
  }

  // Risk nur wenn relevant (level >= medium oder Tags vorhanden)
  if (msl.risk && (msl.risk.level !== "low" || msl.risk.tags.length > 0)) {
    view.risk = {
      level: msl.risk.level,
      score: msl.risk.score,
      tags: msl.risk.tags,
    };
  }

  // reason nur bei blocked oder manual_pending
  if (msl.decision === "blocked" || msl.decision === "rejected") {
    if (msl.reason) view.reason = msl.reason;
  } else if (msl.decision === "not_evaluated" && msl.requiresManualApply) {
    view.reason = "Wartet auf manuelle Freigabe durch den User.";
  }

  return view;
};

// Header-Zeile und JSON-Block - message nicht doppelt im JSON
// @ToDo message-Header ungekappt -> auch kappen
// @ToDo 4000 Magic Number -> benannte Konstante (LLM_VIEW_MAX_JSON_CHARS, ugf 4 Zeichen/Token)
const serializeLlmView = (view: LlmToolView): string => {
  const { message, ...body } = view;
  // reason-Duplikat zur message vermeiden
  const compact: Record<string, unknown> = { ...body };
  if (
    typeof compact.reason === "string" &&
    typeof message === "string" &&
    compact.reason === message
  ) {
    delete compact.reason;
  }
  return `${message}\n${serializePreview(compact, 4000)}`;
};

export const createErrorToolResult = (tool: string, error: unknown) => {
  const classified = classifyToolError(error);
  const envelope: BaselineToolEnvelope = {
    ok: false,
    status: classified.status,
    code: classified.code,
    message: classified.message,
    tool,
    agent: {
      shouldAbort: classified.shouldAbort,
      nextAction: classified.shouldAbort ? "stop" : "continue",
    },
    platform: {
      adapterId: "lowcoder-api",
      mode: classified.msl.enabled
        ? "msl_guarded_apply"
        : "baseline_direct_apply",
    },
    msl: classified.msl,
    error: {
      type: classified.type,
      details: classified.details,
    },
  };

  // LLM bekommt kompakten view mit reason und ggf zod-issues -> voller envelope
  // bleibt für Frontend in structuredContent
  const errorView: LlmToolView = buildLlmView(envelope);
  if (classified.code === "invalid_request" && classified.details) {
    errorView.errorDetails = classified.details;
  }
  if (!errorView.reason) errorView.reason = classified.message;

  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: serializeLlmView(errorView),
      },
    ],
    structuredContent: envelope,
  };
};

const classifyToolError = (
  error: unknown,
): {
  status: ToolStatus;
  code: ToolCode;
  type: string;
  message: string;
  details?: unknown;
  shouldAbort: boolean;
  msl: BaselineToolEnvelope["msl"];
} => {
  if (error instanceof ZodError) {
    return {
      status: "error",
      code: "invalid_request",
      type: "validation_error",
      message: formatZodErrorMessage(error),
      details: error.issues,
      shouldAbort: false,
      msl: {
        enabled: false,
        decision: "not_evaluated",
      },
    };
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : (() => {
            try {
              return JSON.stringify(error);
            } catch {
              return String(error);
            }
          })();

  if (error instanceof MslRejectionError) {
    return {
      status: "rejected",
      code: "msl_rejected",
      type: "msl_rejected",
      message,
      shouldAbort: true,
      details: error.mslPayload ? { mslPayload: error.mslPayload } : undefined,
      msl: {
        enabled: true,
        decision: "rejected",
        reason: message,
        ...(error.planId ? { planId: error.planId } : {}),
      },
    };
  }

  const planId = extractPlanId(message);
  if (message.includes("not found")) {
    return {
      status: "error",
      code: "invalid_request",
      type: "component_not_found",
      message,
      shouldAbort: false,
      msl: {
        enabled: false,
        decision: "not_evaluated",
        planId,
      },
    };
  }

  if (message.includes("Lowcoder") || message.includes("HTTP")) {
    return {
      status: "error",
      code: "platform_error",
      type: "platform_error",
      message,
      shouldAbort: false,
      msl: {
        enabled: false,
        decision: "not_evaluated",
        planId,
      },
    };
  }

  return {
    status: "error",
    code: "unknown_error",
    type: "unknown_error",
    message,
    shouldAbort: false,
    msl: {
      enabled: false,
      decision: "not_evaluated",
      planId,
    },
  };
};

const inferMode = (
  data: SuccessToolData,
): BaselineToolEnvelope["platform"]["mode"] => {
  const raw = data.mode;
  if (raw === "msl_guarded_apply") {
    return "msl_guarded_apply";
  }
  if (raw === "msl_manual_plan") {
    return "msl_manual_plan";
  }
  return "baseline_direct_apply";
};

const inferMsl = (
  data: SuccessToolData,
  mode: BaselineToolEnvelope["platform"]["mode"],
): MslPayload => {
  if (data.msl) return data.msl;
  return {
    enabled: mode === "msl_guarded_apply" || mode === "msl_manual_plan",
    decision: "not_evaluated",
  };
};

const extractPlanId = (message: string): string | undefined => {
  const match = message.match(/\[planId=([^\]]+)\]/);
  if (!match) {
    return undefined;
  }
  const value = match[1].trim();
  return value.length > 0 ? value : undefined;
};
