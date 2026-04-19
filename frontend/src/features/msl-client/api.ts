import type { BackplaneConfigResponse, RuntimeConfigPatch } from './types';

interface MslClientOptions {
  baseUrl: string;
  actorId: string;
}

const jsonHeaders = { 'content-type': 'application/json' };

export class MslClient {
  readonly baseUrl: string;
  readonly actorId: string;

  constructor(options: MslClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.actorId = options.actorId;
  }

  async getConfig(): Promise<BackplaneConfigResponse> {
    return this.fetchJson<BackplaneConfigResponse>('/admin/config');
  }

  async updateConfig(patch: RuntimeConfigPatch): Promise<Record<string, unknown>> {
    return this.fetchJson('/admin/config', {
      method: 'POST',
      headers: { ...jsonHeaders, 'x-msl-actor-id': this.actorId },
      body: JSON.stringify({ patch }),
    });
  }

  async approvePlan(planId: string, reason?: string): Promise<Record<string, unknown>> {
    return this.fetchJson(`/admin/plans/${encodeURIComponent(planId)}/approve`, {
      method: 'POST',
      headers: { ...jsonHeaders, 'x-msl-actor-id': this.actorId },
      body: JSON.stringify(reason ? { reason } : {}),
    });
  }

  async rejectPlan(planId: string, reason?: string): Promise<Record<string, unknown>> {
    return this.fetchJson(`/admin/plans/${encodeURIComponent(planId)}/reject`, {
      method: 'POST',
      headers: { ...jsonHeaders, 'x-msl-actor-id': this.actorId },
      body: JSON.stringify(reason ? { reason } : {}),
    });
  }

  async applyPlan(planId: string): Promise<Record<string, unknown>> {
    return this.fetchJson(`/admin/plans/${encodeURIComponent(planId)}/apply`, {
      method: 'POST',
      headers: { ...jsonHeaders, 'x-msl-actor-id': this.actorId },
      body: JSON.stringify({}),
    });
  }

  async clearAllPlans(reason?: string): Promise<{ ok: boolean; rejectedCount: number }> {
    return this.fetchJson('/admin/plans/cleanup', {
      method: 'POST',
      headers: { ...jsonHeaders, 'x-msl-actor-id': this.actorId },
      body: JSON.stringify(reason ? { reason } : {}),
    });
  }

  async sendChatMessage(input: {
    message: string;
    projectId?: string;
    model?: string;
    history?: Array<{ role: string; content: string }>;
  }): Promise<ChatResponse> {
    return this.fetchJson<ChatResponse>('/admin/chat', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(input),
    });
  }

  async getProjects(): Promise<Array<{ applicationId: string; name?: string; title?: string }>> {
    const data = await this.fetchJson<Record<string, unknown>>('/admin/projects');
    const projects = (data.projects as Record<string, unknown>)?.projects ?? data.projects ?? [];
    return projects as Array<{ applicationId: string; name?: string; title?: string }>;
  }

  private async fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, options);
    if (!response.ok) {
      const body = await this.safeReadError(response);
      throw new Error(`HTTP ${response.status}: ${body}`);
    }
    return (await response.json()) as T;
  }

  private async safeReadError(response: Response): Promise<string> {
    try {
      const payload = (await response.json()) as { message?: string };
      return typeof payload?.message === 'string' ? payload.message : JSON.stringify(payload);
    } catch {
      return response.statusText || 'Request failed';
    }
  }
}

export interface ChatToolCallResult {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  msl?: Record<string, unknown>;
}

export interface ChatResponse {
  ok: boolean;
  assistantMessage: string;
  toolCalls: ChatToolCallResult[];
  model: string;
}
