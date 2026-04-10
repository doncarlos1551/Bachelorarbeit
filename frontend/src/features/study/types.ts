export type ParticipantGroup = 'professional_dev' | 'citizen_dev';
export type MslVariant = 'baseline' | 'summary' | 'diff' | 'diff_risk' | 'full';
export type StudySessionStatus = 'active' | 'completed' | 'aborted';
export type CaseStatus = 'pending' | 'active' | 'completed' | 'skipped';

export interface StudyCase {
  caseId: string;
  title: string;
  description: string;
  goal: string;
  context: string;
  taskInstruction?: string;
  examplePrompt?: string;
  expectedMslBehavior?: string;
  groundTruth?: {
    risk: string;
    decision: 'approve' | 'reject';
    why: string;
  };
  sortOrder: number;
}

export interface StudySession {
  studySessionId: string;
  participantId: string;
  participantGroup: ParticipantGroup;
  counterbalanceDesignId: string;
  mslVariant: MslVariant;
  status: StudySessionStatus;
  mslSessionId?: string;
  caseSequence: string[];
  currentCaseIndex: number;
  metadata?: Record<string, unknown>;
  startedAt: string;
  completedAt?: string;
}

export interface StudyCaseRun {
  caseRunId: string;
  studySessionId: string;
  caseId: string;
  variant: MslVariant;
  status: CaseStatus;
  projectId?: string;
  planIds: string[];
  gateEvents: StudyGateEvent[];
  startedAt?: string;
  completedAt?: string;
}

export interface StudyGateEvent {
  timestamp: string;
  planId: string;
  gate: string;
  mode: string;
  passed: boolean;
  blocked: boolean;
  riskLevel?: string;
  riskScore?: number;
}

export interface StudyResponse {
  responseId: string;
  studySessionId: string;
  caseRunId: string;
  caseId: string;
  variant: MslVariant;
  decision?: 'approve' | 'reject';
  correct?: boolean;
  decisionTimeMs?: number;
  trustRating?: number;
  confidenceRating?: number;
  transparencyRating?: number;
  controlRating?: number;
  notes?: string;
  additionalItems?: Record<string, unknown>;
  createdAt: string;
}

export interface CounterbalanceDesign {
  designId: string;
  blocks: Array<{
    variant: string;
    caseIds: string[];
  }>;
}

export interface LiveTask {
  caseId: string;
  title: string;
  taskInstruction: string;
  context: string;
  examplePrompt?: string;
  expectedMslBehavior?: string;
  groundTruth?: {
    risk: string;
    decision: 'approve' | 'reject';
    why: string;
  };
}
