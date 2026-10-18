export type RoomStatus = 'verified' | 'in_progress' | 'planned' | 'blocked';

export interface ArchitecturalRoom {
  id: string;
  name: string;
  layer: 'foundation' | 'core' | 'service' | 'gateway';
  status: RoomStatus;
  description: string;
  evidence: string;
  metrics: {
    testsPassed?: number;
    totalTests?: number;
    filesCount?: number;
  };
  coords: {
    isoX: number;
    isoY: number;
    width: number;
    height: number;
    depth: number;
  };
}

export interface ChatMessagePreview {
  id: string;
  sender: 'dog' | 'cat';
  speakerName: string;
  tagline: string;
  content: string;
  timestamp: string;
}
