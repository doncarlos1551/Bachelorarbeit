export interface SessionRecord {
  sessionId: string;
  sessionTokenHash?: string;
  actorId: string;
  chatId?: string;
  lastProjectId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EnsureSessionInput {
  sessionId?: string;
  sessionToken?: string;
  actorId: string;
  chatId?: string;
  projectId?: string;
}
