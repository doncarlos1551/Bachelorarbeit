import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

// === Backplane-Events ===
// Event-Typen und Pub/Sub-API für SSE-Stream

export type BackplaneEventType =
  | "tool.call_received"
  | "tool.call_completed"
  | "tool.call_failed"
  | "tool.approval_pending"
  | "plan.created"
  | "plan.decision"
  | "plan.applied"
  | "plan.apply_failed"
  | "admin.config_updated";

export interface BackplaneEvent {
  eventId: string;
  eventType: BackplaneEventType;
  at: string;
  sessionId?: string;
  planId?: string;
  projectId?: string;
  payload?: Record<string, unknown>;
}

export type BackplaneEventListener = (event: BackplaneEvent) => void;

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export const publishBackplaneEvent = (
  input: Omit<BackplaneEvent, "eventId" | "at"> & {
    eventId?: string;
    at?: string;
  },
): BackplaneEvent => {
  const event: BackplaneEvent = {
    eventId: input.eventId ?? randomUUID(),
    eventType: input.eventType,
    at: input.at ?? new Date().toISOString(),
    sessionId: input.sessionId,
    planId: input.planId,
    projectId: input.projectId,
    payload: input.payload,
  };
  emitter.emit("event", event);
  return event;
};

export const subscribeBackplaneEvents = (
  listener: BackplaneEventListener,
): (() => void) => {
  emitter.on("event", listener);
  return () => {
    emitter.off("event", listener);
  };
};
