export interface ProjectLockRequest {
  projectId: string;
  sessionId: string;
  actorId: string;
  chatId?: string;
  ttlSeconds: number;
}

export interface ProjectLockResult {
  acquired: boolean;
  ownerSessionId?: string;
  expiresAt?: string;
}
