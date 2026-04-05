import { WorkspaceContextStore } from "src/app/context-store";
import type { WorkspaceContext } from "src/app/context-store.interfaces";
import { LowcoderClient } from "src/adapters/lowcoder/client";
import * as readService from "src/app/service/read-service";

export type { ApplyOperationsInput } from "src/app/service/baseline-service.interfaces";

export class BaselineService {
  // public-readonly damit Module in service bzw read-service auf den State zugreifen können
  readonly context: WorkspaceContextStore;
  readonly client: LowcoderClient;

  constructor() {
    this.client = LowcoderClient.fromEnv();
    this.context = new WorkspaceContextStore(
      process.env.DEFAULT_ACTOR_ID ?? "mcp-client",
    );
  }

  // === Read & Workspace ===

  getWorkspaceContext(): WorkspaceContext {
    return readService.getWorkspaceContext(this);
  }

  setWorkspaceContext(input: {
    projectId?: string;
    actorId?: string;
    sessionId?: string;
    chatId?: string;
  }): WorkspaceContext {
    return readService.setWorkspaceContext(this, input);
  }

  async listProjects(
    limit: number,
    search?: string,
  ): Promise<Record<string, unknown>> {
    return readService.listProjects(this, limit, search);
  }

  async createProject(projectName: string): Promise<Record<string, unknown>> {
    return readService.createProject(this, projectName);
  }

  async projectSummary(projectId?: string): Promise<Record<string, unknown>> {
    return readService.projectSummary(this, projectId);
  }

  async listComponents(
    projectId?: string,
    limit = 200,
  ): Promise<Record<string, unknown>> {
    return readService.listComponents(this, projectId, limit);
  }

  async inspectDsl(
    projectId?: string,
    options?: { componentId?: string; includeRawDsl?: boolean },
  ): Promise<Record<string, unknown>> {
    return readService.inspectDsl(this, projectId, options);
  }
}
