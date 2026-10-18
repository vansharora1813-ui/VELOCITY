import React from 'react';
import { SAMPLE_PROJECT } from '../data/sampleData';

interface HeaderProps {
  sourceName?: string;
  sourceStatusLabel?: string;
  isRealRepo?: boolean;
  branchName?: string;
  scanStatus?: 'completed' | 'partial' | 'failed';
}

export const Header: React.FC<HeaderProps> = ({
  sourceName = SAMPLE_PROJECT.name,
  sourceStatusLabel = SAMPLE_PROJECT.statusLabel,
  isRealRepo = false,
  branchName,
  scanStatus,
}) => {
  return (
    <header className="app-header">
      <div className="header-brand">
        <div className="brand-title-row">
          <span className="brand-name">The Living Blueprint</span>
          <span className="version-pill">v0.11.0 · Milestone T11</span>
        </div>
        <p className="brand-purpose">
          Evidence-backed architecture verification for AI coding agent projects
        </p>
      </div>

      <div className="header-status">
        <div
          className={`status-badge ${isRealRepo ? 'real-repo' : 'sample-data'}`}
          title={isRealRepo ? 'Real repository scanned from GitHub REST API' : 'Fallback demonstration dataset'}
        >
          <span className={`status-indicator-dot ${isRealRepo ? 'real' : 'sample'}`} />
          <span>
            Source: <strong>{sourceName}</strong>{' '}
            {branchName && <span className="branch-label">[{branchName}]</span>}{' '}
            ({isRealRepo ? `Real Scan · ${scanStatus?.toUpperCase() ?? 'COMPLETED'}` : sourceStatusLabel})
          </span>
        </div>
      </div>
    </header>
  );
};
