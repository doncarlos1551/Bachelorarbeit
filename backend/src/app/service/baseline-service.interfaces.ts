import type { BaselineOperation } from "src/app/operations";

export interface ApplyOperationsInput {
  projectId?: string;
  sessionId?: string;
  chatId?: string;
  userComment?: string;
  operations: BaselineOperation[];
  mcpCall?: { name: string; args: Record<string, unknown> };
}
