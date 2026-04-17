import { publishBackplaneEvent } from "src/app/backplane-events";
import type { BaselineOperation } from "src/app/operations";

// === Tool-Lifecycle-Events ===
// Typed Wrapper um publishBackplaneEvent für Tool-Call-Phasen
// received -> MCP-Tool-Aufruf vor MSL-Pipeline
// approval_pending -> Plan im preflighted Status Wait-Loop
// completed (applied=true|false) -> auto/approve applied bzw rejected/timeout/apply_failed
// failed -> unerwartete Exception im Service-Pfad

interface ToolEventBase {
  sessionId: string;
  projectId: string;
  planId?: string;
  toolCallId: string;
}

interface ToolReceivedInput extends ToolEventBase {
  actorId: string;
  chatId?: string;
  operations: BaselineOperation[];
  userComment?: string;
}

interface ApprovalPendingInput extends ToolEventBase {
  mode: string;
  riskLevel?: string;
}

interface ToolCompletedInput extends ToolEventBase {
  mode: string;
  applied: boolean;
  decision?: string;
}

interface ToolFailedInput extends ToolEventBase {
  message: string;
}

export const emitToolReceived = (input: ToolReceivedInput): void => {
  publishBackplaneEvent({
    eventType: "tool.call_received",
    sessionId: input.sessionId,
    projectId: input.projectId,
    payload: {
      toolCallId: input.toolCallId,
      actorId: input.actorId,
      chatId: input.chatId,
      operationCount: input.operations.length,
      operationKinds: input.operations.map((operation) => operation.kind),
      operations: input.operations,
      userComment: input.userComment,
    },
  });
};

export const emitApprovalPending = (input: ApprovalPendingInput): void => {
  publishBackplaneEvent({
    eventType: "tool.approval_pending",
    sessionId: input.sessionId,
    planId: input.planId,
    projectId: input.projectId,
    payload: {
      toolCallId: input.toolCallId,
      mode: input.mode,
      riskLevel: input.riskLevel,
    },
  });
};

export const emitToolCompleted = (input: ToolCompletedInput): void => {
  publishBackplaneEvent({
    eventType: "tool.call_completed",
    sessionId: input.sessionId,
    planId: input.planId,
    projectId: input.projectId,
    payload: {
      toolCallId: input.toolCallId,
      mode: input.mode,
      applied: input.applied,
      ...(input.decision ? { decision: input.decision } : {}),
    },
  });
};

export const emitToolFailed = (input: ToolFailedInput): void => {
  publishBackplaneEvent({
    eventType: "tool.call_failed",
    sessionId: input.sessionId,
    projectId: input.projectId,
    payload: {
      toolCallId: input.toolCallId,
      message: input.message,
    },
  });
};
