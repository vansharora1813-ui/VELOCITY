import React from 'react';
import type { GitHubScanResult } from '../domain/github/types.ts';

interface ScanDetailsDrawerProps {
  scanResult: GitHubScanResult | null;
  isOpen: boolean;
  onClose: () => void;
}

export const ScanDetailsDrawer: React.FC<ScanDetailsDrawerProps> = ({
  scanResult,
  isOpen,
  onClose,
}) => {
  if (!isOpen || !scanResult) return null;

  return (
    <div
      className="scan-drawer-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="GitHub Repository Scan Details"
    >
      <div className="scan-drawer-content" onClick={(e) => e.stopPropagation()}>
        <div className="scan-drawer-header">
          <div>
            <h3 className="scan-drawer-title">
              Repository Scan Telemetry: {scanResult.owner}/{scanResult.repo}
            </h3>
            <div className="scan-drawer-subtitle">
              Branch: <code>{scanResult.metadata?.defaultBranch || 'default'}</code> · Status:{' '}
              <span className={`status-pill ${scanResult.status}`}>
                {scanResult.status.toUpperCase()}
              </span>
              {' '}· Duration: {scanResult.durationMs}ms
            </div>
          </div>
          <button className="room-detail-close" onClick={onClose} title="Close drawer">
            ✕
          </button>
        </div>

        {/* Warnings or Limitations Banner */}
        {scanResult.warnings.length > 0 && (
          <div className="scan-warning-box">
            <strong>Coverage Limitations:</strong>
            <ul>
              {scanResult.warnings.map((w, idx) => (
                <li key={idx}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Rate limit info */}
        {scanResult.rateLimit && (
          <div className="scan-ratelimit-info">
            GitHub REST Quota Remaining: <strong>{scanResult.rateLimit.remaining}</strong> /{' '}
            {scanResult.rateLimit.limit} req/hr (Resets:{' '}
            {new Date(scanResult.rateLimit.resetDate).toLocaleTimeString()})
          </div>
        )}

        {/* Metrics Grid */}
        <div className="scan-metrics-grid">
          <div className="scan-metric-card">
            <span className="metric-val">{scanResult.totalFilesDiscovered}</span>
            <span className="metric-lbl">Files in Git Tree</span>
          </div>
          <div className="scan-metric-card">
            <span className="metric-val">{scanResult.inspectedFiles.length}</span>
            <span className="metric-lbl">Files Inspected</span>
          </div>
          <div className="scan-metric-card">
            <span className="metric-val">{scanResult.skippedFiles.length}</span>
            <span className="metric-lbl">Files Excluded / Skipped</span>
          </div>
          <div className="scan-metric-card">
            <span className="metric-val">{scanResult.detectedTechnologies.length}</span>
            <span className="metric-lbl">Tech Stacks Detected</span>
          </div>
        </div>

        {/* Detected Tech */}
        {scanResult.detectedTechnologies.length > 0 && (
          <div className="scan-tech-section">
            <div className="section-label">DETECTED TECHNOLOGIES & TOOLS:</div>
            <div className="tech-tags-list">
              {scanResult.detectedTechnologies.map((tech) => (
                <span key={tech} className="tech-tag">
                  {tech}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Inspected Files List */}
        <div className="scan-files-section">
          <div className="section-label">
            INSPECTED FILES ({scanResult.inspectedFiles.length} bounded sample):
          </div>
          <div className="inspected-files-list">
            {scanResult.inspectedFiles.map((file) => (
              <div key={file.path} className="inspected-file-item">
                <div className="file-item-header">
                  <div className="file-path-row">
                    <span className={`file-category-badge ${file.category}`}>{file.category}</span>
                    <a
                      href={file.githubUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="file-link"
                      title="Open file on GitHub"
                    >
                      {file.path} ↗
                    </a>
                  </div>
                  <span className="file-size">{(file.sizeBytes / 1024).toFixed(1)} KB</span>
                </div>
                {file.contentExcerpt && (
                  <pre className="file-excerpt">{file.contentExcerpt.slice(0, 300)}...</pre>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
