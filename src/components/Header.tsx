import React from 'react';
import { SAMPLE_PROJECT } from '../data/sampleData';

export const Header: React.FC = () => {
  return (
    <header className="app-header">
      <div className="header-brand">
        <div className="brand-title-row">
          <span className="brand-name">The Living Blueprint</span>
          <span className="version-pill">v0.1.0 · Milestone T01</span>
        </div>
        <p className="brand-purpose">
          Evidence-backed architecture verification for AI coding agent projects
        </p>
      </div>

      <div className="header-status">
        <div className="status-badge" title="Live GitHub integration is planned for future milestones">
          <span className="status-indicator-dot" />
          <span>Source: {SAMPLE_PROJECT.name} ({SAMPLE_PROJECT.statusLabel})</span>
        </div>
      </div>
    </header>
  );
};
