/** Public non-contract interfaces. TripContract is generated from JSON Schema. */
export type VerificationState = 'declared' | 'extracted' | 'confirmed' | 'conflicting' | 'expired';
export interface SourceSpan {
  page?: number;
  line?: number;
  quote: string;
}
export interface ExtractedField {
  path: string;
  value: unknown;
  state: VerificationState;
  method: 'text' | 'ocr' | 'llm' | 'user';
  source: SourceSpan;
}
export interface EvidenceDocument {
  id: string;
  tripId: string;
  mediaType: string;
  bytes: number;
  sha256: string;
  createdAt: string;
  expiresAt: string | null;
  label: string;
  fields: ExtractedField[];
  status: 'quarantined' | 'ready' | 'needs_review' | 'rejected';
  warnings: string[];
  parserVersion: string;
  derivedFrom: string | null;
  facts?: LiteralFact[];
  preview?: Array<{ page?: number; line: number; text: string }>;
}
export interface LiteralFact {
  kind: 'supplier' | 'date' | 'money';
  value:
    | string
    | { iso: string; precision: 'date' | 'offset_datetime' | 'local_datetime_zone_unknown' }
    | { currency: string; minorUnits: number };
  state: 'extracted';
  source: SourceSpan;
}
export interface Finding {
  code: string;
  severity: 'info' | 'warning' | 'critical';
  serviceId?: string;
  parameters: Record<string, string | number>;
  sourceId?: string;
}
export interface Assessment {
  version: '1.0.0';
  findings: Finding[];
  riskIndicator: number | null;
  informationCoveragePercent: number;
  riskMeaning: 'heuristic_not_probability';
  totals: Record<string, number>;
  evaluatedAt: string;
}
export interface ChecklistItem {
  code: string;
  serviceId?: string;
  status: 'complete' | 'pending' | 'not_applicable';
  parameters: Record<string, string | number>;
}
export interface DisruptionEvent {
  id: string;
  tripId: string;
  serviceId: string;
  kind:
    | 'delay'
    | 'cancellation'
    | 'denied_boarding'
    | 'baggage_issue'
    | 'lodging_issue'
    | 'refund_requested'
    | 'refund_received';
  occurredAt: string;
  waitingMinutes: number | null;
  overnight: boolean;
  specialAssistance: boolean;
  providerResponsibility: 'yes' | 'no' | 'unknown';
  description: string;
  documentIds: string[];
  amountMinor: number | null;
  currency: string | null;
  source: 'user' | 'webhook';
  phase: 'departure' | 'in_transit' | 'arrival' | 'unknown';
  refundChoice: 'continue' | 'refund' | 'unknown';
  residentAtOrigin: boolean | null;
  exceptionalConditions: 'none' | 'active' | 'unknown';
}
export interface RuleAdvice {
  ruleId: string;
  status: 'applicable' | 'needs_review';
  messageKey: string;
  sourceUrl: string;
  article: string;
  evidenceCodes: string[];
  validFrom: string;
  validTo: string | null;
}
export interface Review {
  id: string;
  tripId: string;
  serviceId: string;
  evidenceDocumentId: string;
  comparisons?: Array<{
    attribute:
      'cleanliness' | 'accessibility' | 'internet' | 'noise' | 'beds' | 'check_in' | 'other';
    advertised: string | null;
    observed: string | null;
  }>;
  comparisonSummary?: {
    compared: number;
    differentText: number;
    incomplete: number;
    verification: 'traveler_report_only';
  };
  ratings: {
    cleanliness: number | null;
    accessibility: number | null;
    accuracy: number | null;
    service: number | null;
    resolution: number | null;
  };
  text: string;
  status: 'private' | 'pending' | 'approved' | 'rejected';
  evidenceLevel: 'document_attached';
  createdAt: string;
}
export interface RouteVersion {
  id: string;
  version: number;
  title: string;
  country: string;
  segments: Array<{
    label: string;
    mode: 'walk' | 'car' | 'bus' | 'flight' | 'rail' | 'boat';
    durationMinutes: number | null;
    distanceKm: number | null;
    costMinor: number | null;
    currency: string | null;
    accessibility: 'unknown' | 'step_free' | 'barriers';
    supportPoints: string[];
  }>;
  seasonality: string;
  safetyNotes: string;
  alternative: string;
  provenance: Array<{ url: string; license: string; checkedAt: string; claim: string }>;
  createdAt: string;
}
export interface Job {
  id: string;
  tripId: string;
  documentId: string | null;
  status: 'queued' | 'running' | 'completed' | 'needs_review' | 'failed';
  errorCode: string | null;
  createdAt: string;
}
export interface Envelope<T> {
  id: string;
  version: number;
  data: T;
  updatedAt: string;
}
export type Role = 'owner' | 'editor' | 'viewer';
export interface Session {
  userId: string;
  workspaceId: string;
  issuedAt: number;
  expiresAt: number;
  demo: boolean;
  csrf: string;
}
