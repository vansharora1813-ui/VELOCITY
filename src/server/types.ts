/**
 * Types for Server-Side AI Companions and Provider Integration
 */

export type CompanionSpeaker = 'dog' | 'cat';

export interface CompanionReplyMessage {
  speaker: CompanionSpeaker;
  text: string;
  evidenceReference?: string;
}

export interface ChatTurn {
  id: string;
  userMessage: string;
  timestamp: string;
  replies: CompanionReplyMessage[];
  selectedRoomId?: string;
}

export interface ChatApiRequest {
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; text: string; speaker?: CompanionSpeaker }>;
  selectedRoomId?: string;
  repoContext?: {
    owner: string;
    repo: string;
    branch: string;
    totalFiles: number;
    inspectedFiles: Array<{ path: string; category: string }>;
    detectedTechnologies: string[];
    roomSummaries: Array<{ id: string; name: string; status: string; evidence: string }>;
  };
}

export interface ChatApiResponse {
  success: boolean;
  replies?: CompanionReplyMessage[];
  error?: string;
  code?: 'CONFIG_REQUIRED' | 'RATE_LIMITED' | 'PROVIDER_ERROR' | 'INVALID_REQUEST';
}
