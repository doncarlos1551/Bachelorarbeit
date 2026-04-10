export type GateMode = 'off' | 'observe' | 'enforce';

export type PlanStatus =
  | 'preflighted'
  | 'approved'
  | 'blocked'
  | 'rejected'
  | 'applied'
  | 'apply_failed';

export interface GateEvaluation {
  gate: string;
  mode: GateMode;
  evaluated: boolean;
  passed: boolean;
  blocked: boolean;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface PlanRisk {
  level: 'low' | 'medium' | 'high';
  score: number;
  tags: string[];
  reasons: string[];
  requiresApproval: boolean;
}

export interface PlanDiff {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  delta: Record<string, number>;
  operationKinds: string[];
  affectedObjects?: string[];
}

export interface PlanValidation {
  passed: boolean;
  errors: string[];
  warnings: string[];
}

export interface RuntimeMslConfig {
  enabled: boolean;
  executionMode: 'auto' | 'manual';
  approvalRiskThreshold: 'medium' | 'high';
  gateModes: {
    policy: GateMode;
    preflight: GateMode;
    diff: GateMode;
    risk: GateMode;
    validation: GateMode;
    approval: GateMode;
    audit: GateMode;
  };
}

export interface BackplaneConfigResponse {
  mode: string;
  msl: RuntimeMslConfig;
}

export interface RuntimeConfigPatch {
  executionMode?: 'auto' | 'manual';
  approvalRiskThreshold?: 'medium' | 'high';
  gateModes?: Partial<RuntimeMslConfig['gateModes']>;
}
