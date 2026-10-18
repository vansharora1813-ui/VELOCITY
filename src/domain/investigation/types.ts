import type { CompanionReplyMessage } from '../../server/types.ts';

export type IssueCategory =
  | 'missing_proof'
  | 'possible_bug'
  | 'security_risk'
  | 'configuration_risk'
  | 'test_gap'
  | 'dependency_risk'
  | 'unknown';

export type IssueSeverity = 'info' | 'low' | 'medium' | 'high';

export type EvidenceClassification = 'observed' | 'inferred' | 'unverified';

export interface ValidatedEvidenceRef {
  path: string;
  isInspected: boolean;
  githubUrl?: string;
  note?: string;
}

export interface RoomInvestigationFinding {
  roomId: string;
  roomName: string;
  title: string;
  explanation: string;
  category: IssueCategory;
  severity: IssueSeverity;
  evidenceClassification: EvidenceClassification;
  evidenceReferences: ValidatedEvidenceRef[];
  rejectedReferences?: string[];
  recommendedNextStep: string;
  uncertainties: string;
  companionMessages: CompanionReplyMessage[];
  generatedPrompt?: string;
}

export interface InvestigateApiRequest {
  roomId: string;
  roomName: string;
  roomLayer: string;
  roomStatus: string;
  roomEvidence: string;
  repoContext: {
    owner: string;
    repo: string;
    branch: string;
    commitSha?: string;
    inspectedFiles: Array<{ path: string; category: string; contentExcerpt?: string }>;
    discoveredFilePaths?: string[];
    detectedTechnologies: string[];
    dependencies?: string[];
  };
}

export interface InvestigateApiResponse {
  success: boolean;
  finding?: RoomInvestigationFinding;
  error?: string;
  code?: 'CONFIG_REQUIRED' | 'RATE_LIMITED' | 'PROVIDER_ERROR' | 'INVALID_REQUEST';
}
