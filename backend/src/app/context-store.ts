import type { WorkspaceContext } from "src/app/context-store.interfaces";

export class WorkspaceContextStore {
  private state: WorkspaceContext;

  constructor(defaultActorId: string) {
    this.state = {
      actorId: defaultActorId,
      updatedAt: new Date().toISOString(),
    };
  }

  get(): WorkspaceContext {
    return { ...this.state };
  }

  set(next: {
    projectId?: string;
    actorId?: string;
    sessionId?: string;
    chatId?: string;
  }): WorkspaceContext {
    this.state = {
      projectId: next.projectId ?? this.state.projectId,
      actorId: next.actorId ?? this.state.actorId,
      sessionId: next.sessionId ?? this.state.sessionId,
      chatId: next.chatId ?? this.state.chatId,
      updatedAt: new Date().toISOString(),
    };
    return this.get();
  }
}
