import type { BaselineOperation } from "src/app/operations";
import type { SchemaIssue } from "src/msl/gates/gates.interfaces";

export interface ApplyOperationsInput {
  projectId?: string;
  sessionId?: string;
  chatId?: string;
  userComment?: string;
  operations: BaselineOperation[];
  mcpCall?: { name: string; args: Record<string, unknown> };
  schemaIssues?: SchemaIssue[];
  operationIndexes?: number[];
}
