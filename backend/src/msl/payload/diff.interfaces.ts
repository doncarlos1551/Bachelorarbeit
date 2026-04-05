export interface DiffResult {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  delta: Record<string, number>;
  operationKinds: string[];
  affectedObjects?: string[];
  externalEndpoints?: string[];
  diffSummary?: string;
  // RFC 6902 JSON-Patch-Vergleich vor und nach Apply
  structuralDiff?: {
    humanSummary: string[];
    humanEntries?: Array<{
      headline: string;
      kind:
        | "component"
        | "property"
        | "event"
        | "query"
        | "rename"
        | "tempState"
        | "preload"
        | "generic";
      subjectName?: string;
      propertyName?: string;
      oldValue?: string;
      newValue?: string;
      multiline?: boolean;
      path: string;
      category: "semantic" | "structural";
    }>;
    counts: {
      semantic: number;
      structural: number;
      metadata: number;
      total: number;
    };
  };
}
