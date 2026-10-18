import React from 'react';
import { ArchitecturalRoom } from '../types';

interface RoomInspectorProps {
  room: ArchitecturalRoom | null;
  onClose: () => void;
}

export const RoomInspector: React.FC<RoomInspectorProps> = ({ room, onClose }) => {
  if (!room) return null;

  const getStatusBadge = (status: ArchitecturalRoom['status']) => {
    switch (status) {
      case 'verified':
        return <span style={{ color: 'var(--status-verified)' }}>✓ Verified by Evidence</span>;
      case 'in_progress':
        return <span style={{ color: 'var(--status-progress)' }}>⚡ Under Construction (WIP)</span>;
      case 'planned':
        return <span style={{ color: 'var(--status-planned)' }}>○ Planned (Wireframe Spec)</span>;
      case 'blocked':
        return <span style={{ color: 'var(--status-blocked)' }}>✕ Failing / Blocked</span>;
    }
  };

  return (
    <div className="room-detail-panel" role="region" aria-label="Room Architecture Inspector">
      <div className="room-detail-header">
        <div>
          <div className="room-detail-title">{room.name}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Layer: {room.layer} · Status: {getStatusBadge(room.status)}
          </div>
        </div>
        <button
          className="room-detail-close"
          onClick={onClose}
          aria-label="Close room details"
          title="Close"
        >
          ✕
        </button>
      </div>

      <p className="room-detail-desc">{room.description}</p>

      <div className="room-detail-evidence">
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4 }}>
          VERIFIED EVIDENCE (SAMPLE DATA):
        </div>
        <div>{room.evidence}</div>
      </div>

      <div className="room-detail-metrics">
        <span>Files: {room.metrics.filesCount ?? 0}</span>
        <span>
          Tests:{' '}
          {room.metrics.testsPassed !== undefined
            ? `${room.metrics.testsPassed}/${room.metrics.totalTests} passing`
            : 'N/A'}
        </span>
      </div>
    </div>
  );
};
