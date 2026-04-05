import type { MslPayload } from "src/msl/payload/payload.interfaces";

export type SuccessToolData = Record<string, unknown> & { msl?: MslPayload };

export type ToolStatus = "success" | "error" | "rejected";

export type ToolCode =
  | "applied"
  | "invalid_request"
  | "platform_error"
  | "msl_rejected"
  | "unknown_error";

export interface BaselineToolEnvelope {
  ok: boolean;
  status: ToolStatus;
  code: ToolCode;
  message: string;
  tool: string;
  agent: {
    shouldAbort: boolean;
    nextAction: "continue" | "stop";
  };
  platform: {
    adapterId: "lowcoder-api";
    mode: "baseline_direct_apply" | "msl_guarded_apply" | "msl_manual_plan";
  };
  msl: MslPayload;
  userComment?: string;
  data?: Record<string, unknown>;
  error?: {
    type: string;
    details?: unknown;
  };
}

// Kompakter LLM-View, geht ins Token-Window
// Nur was LLM zur Self-Reflection und nächstem Tool-Call braucht
// Voller Envelope -> structuredContent (Frontend) nicht ins Token-Window
export interface LlmToolView {
  ok: boolean;
  tool: string;
  message: string;
  decision: MslPayload["decision"];
  // Hint dass User noch im UI entscheiden muss also LLM soll nicht nachfragen
  requiresManualApply?: boolean;
  changes?: string[];
  // bei blocked/manual_pending -> warum
  reason?: string;
  // bei approved/manual_pending -> Risk für Self-Reflection
  risk?: { level: string; score: number; tags: string[] };
  // bei manual_pending -> planId für Status-Polling
  planId?: string;
  // bei error mit details -> zod-issues oder mslRejection-payload-snippet
  errorDetails?: unknown;
}
