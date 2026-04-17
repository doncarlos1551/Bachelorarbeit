import type {
  ImpactInfo,
  ValidationWarning,
} from "src/msl/gates/gates.interfaces";
import type { DiffResult } from "src/msl/payload/diff.interfaces";

export interface AdapterPreflightResult<TSnapshot> {
  nextSnapshot: TSnapshot;
  steps: Array<Record<string, unknown>>;
  summary: Record<string, unknown>;
}

export interface AdapterPerOpValidation {
  errors: string[];
  warnings: ValidationWarning[];
}

export interface AdapterBatchFinalize {
  errors: string[];
  warnings: ValidationWarning[];
  impacts: ImpactInfo[];
}

// Map-Reduce-Validierung
export interface AdapterBatchValidator<TOperation> {
  validateOperation(input: {
    operation: TOperation;
    opIndex: number;
  }): AdapterPerOpValidation;
  finalize(): AdapterBatchFinalize;
}

export interface MslAdapter<TOperation, TSnapshot> {
  adapterId: string;
  preflight(input: {
    baselineSnapshot: TSnapshot;
    operations: TOperation[];
  }): AdapterPreflightResult<TSnapshot>;
  diff(input: {
    baselineSnapshot: TSnapshot;
    candidateSnapshot: TSnapshot;
    operations: TOperation[];
  }): DiffResult;
  // Map-Reduce-Factory einmaliger Snapshot-Prep danachn pro Operation
  // @ToDo noch rename proOp -> proOperation
  beginValidation(input: {
    baselineSnapshot: TSnapshot;
    candidateSnapshot: TSnapshot;
    operations: TOperation[];
  }): AdapterBatchValidator<TOperation>;
  listEntityIds(baselineSnapshot: TSnapshot): Set<string>;
}
