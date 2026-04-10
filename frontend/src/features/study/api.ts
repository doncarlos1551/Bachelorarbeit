import type {
  StudyCase,
  StudySession,
  StudyCaseRun,
  StudyResponse,
  CounterbalanceDesign,
  ParticipantGroup,
  LiveTask,
} from './types';

const jsonHeaders = { 'content-type': 'application/json' };

export class StudyClient {
  readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  // === Katalog ===

  async getCases(): Promise<StudyCase[]> {
    const data = await this.get<{ cases: StudyCase[] }>('/admin/study/cases');
    return data.cases;
  }

  async getDesigns(): Promise<CounterbalanceDesign[]> {
    const data = await this.get<{ designs: CounterbalanceDesign[] }>('/admin/study/designs');
    return data.designs;
  }

  async getLiveTasks(): Promise<{ tasks: LiveTask[]; designs: CounterbalanceDesign[] }> {
    return this.get('/admin/study/live-tasks');
  }

  // === Sessions ===

  async createSession(input: {
    participantId: string;
    participantGroup: ParticipantGroup;
    counterbalanceDesignId: string;
    studyMode?: string;
    metadata?: Record<string, unknown>;
  }): Promise<StudySession> {
    const data = await this.post<{ session: StudySession }>('/admin/study/sessions', input);
    return data.session;
  }

  async getSession(id: string): Promise<{
    session: StudySession;
    caseRuns: StudyCaseRun[];
    responses: StudyResponse[];
  }> {
    return this.get(`/admin/study/sessions/${enc(id)}`);
  }

  async updateSession(id: string, patch: Record<string, unknown>): Promise<StudySession> {
    const data = await this.patch<{ session: StudySession }>(
      `/admin/study/sessions/${enc(id)}`,
      patch,
    );
    return data.session;
  }

  // === Case config ===

  async setCaseConfig(variant: string, sessionId?: string): Promise<void> {
    await this.post('/admin/study/case-config', {
      variant,
      ...(sessionId ? { sessionId } : {}),
    });
  }

  // === Case Runs ===

  async createCaseRun(
    sessionId: string,
    caseId: string,
    projectId?: string,
  ): Promise<StudyCaseRun> {
    const data = await this.post<{ caseRun: StudyCaseRun }>(
      `/admin/study/sessions/${enc(sessionId)}/case-runs`,
      { caseId, ...(projectId ? { projectId } : {}) },
    );
    return data.caseRun;
  }

  async updateCaseRun(id: string, patch: Record<string, unknown>): Promise<StudyCaseRun> {
    const data = await this.patch<{ caseRun: StudyCaseRun }>(
      `/admin/study/case-runs/${enc(id)}`,
      patch,
    );
    return data.caseRun;
  }

  async linkPlan(caseRunId: string, planId: string): Promise<void> {
    await this.post(`/admin/study/case-runs/${enc(caseRunId)}/plan`, { planId });
  }

  async recordGateEvent(
    caseRunId: string,
    event: {
      planId: string;
      gate: string;
      mode: string;
      passed: boolean;
      blocked: boolean;
      riskLevel?: string;
      riskScore?: number;
    },
  ): Promise<void> {
    await this.post(`/admin/study/case-runs/${enc(caseRunId)}/gate-event`, event);
  }

  // === Responses ===

  async createResponse(input: {
    studySessionId: string;
    caseRunId: string;
    caseId: string;
    variant: string;
    decision?: string;
    correct?: boolean;
    decisionTimeMs?: number;
    trustRating?: number;
    confidenceRating?: number;
    transparencyRating?: number;
    controlRating?: number;
    notes?: string;
    additionalItems?: Record<string, unknown>;
  }): Promise<StudyResponse> {
    const data = await this.post<{ response: StudyResponse }>('/admin/study/responses', input);
    return data.response;
  }

  // === Export ===

  async exportSession(id: string): Promise<Record<string, unknown>> {
    return this.get(`/admin/study/export/${enc(id)}`);
  }

  async exportSessionCsv(id: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/admin/study/export/${enc(id)}/csv`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }

  // === HTTP Helpers ===

  private async get<T>(path: string): Promise<T> {
    return this.fetchJson(path);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.fetchJson(path, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(body),
    });
  }

  private async patch<T>(path: string, body: unknown): Promise<T> {
    return this.fetchJson(path, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(body),
    });
  }

  private async fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, options);
    if (!res.ok) {
      let msg = res.statusText;
      try {
        const err = (await res.json()) as { message?: string };
        if (err.message) msg = err.message;
      } catch {
        // Ignore non-JSON error body
      }
      throw new Error(`HTTP ${res.status}: ${msg}`);
    }
    return (await res.json()) as T;
  }
}

function enc(s: string): string {
  return encodeURIComponent(s);
}
