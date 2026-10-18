import React, { useState, useEffect } from 'react';
import type { ArchitecturalRoom } from '../types.ts';
import type { GitHubScanResult } from '../domain/github/types.ts';
import type { RoomInvestigationFinding } from '../domain/investigation/types.ts';
import { PixelPetAvatar } from './PixelPetAvatar.tsx';
import { FixLifecyclePanel } from './FixLifecyclePanel.tsx';

interface RoomInspectorProps {
  room: ArchitecturalRoom | null;
  onClose: () => void;
  scanResult: GitHubScanResult | null;
  isSampleActive: boolean;
  onRoomUpdated?: (updatedRoom: ArchitecturalRoom) => void;
}

export const RoomInspector: React.FC<RoomInspectorProps> = ({
  room,
  onClose,
  scanResult,
  isSampleActive,
  onRoomUpdated,
}) => {
  const [isInvestigating, setIsInvestigating] = useState(false);
  const [finding, setFinding] = useState<RoomInvestigationFinding | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  // Clear investigation state when switching rooms
  useEffect(() => {
    setFinding(null);
    setErrorMessage(null);
    setSetupRequired(false);
    setShowPrompt(false);
    setCopySuccess(false);
  }, [room?.id]);

  if (!room) return null;

  const getStatusBadge = (status: ArchitecturalRoom['status']) => {
    switch (status) {
      case 'verified':
        return <span style={{ color: 'var(--status-verified)' }}>✓ Verified by Evidence</span>;
      case 'implemented':
      case 'in_progress':
        return <span style={{ color: 'var(--status-progress)' }}>⚡ Implemented (Verification Pending)</span>;
      case 'planned':
        return <span style={{ color: 'var(--status-planned)' }}>○ Planned (Wireframe Spec)</span>;
      case 'blocked':
        return <span style={{ color: 'var(--status-blocked)' }}>✕ Failing / Blocked</span>;
      case 'unknown':
        return <span style={{ color: '#B6A6C5' }}>? Unknown / Insufficient Evidence</span>;
    }
  };

  const handleInvestigate = async () => {
    setIsInvestigating(true);
    setErrorMessage(null);
    setSetupRequired(false);
    setShowPrompt(false);

    const repoContext = !isSampleActive && scanResult
      ? {
          owner: scanResult.owner,
          repo: scanResult.repo,
          branch: scanResult.metadata?.defaultBranch || 'main',
          commitSha: scanResult.commitSha,
          inspectedFiles: scanResult.inspectedFiles.map((f) => ({
            path: f.path,
            category: f.category,
            contentExcerpt: f.contentExcerpt,
          })),
          discoveredFilePaths: scanResult.inspectedFiles.map((f) => f.path),
          detectedTechnologies: scanResult.detectedTechnologies,
        }
      : {
          owner: 'example',
          repo: 'booknook-demo',
          branch: 'main',
          inspectedFiles: [
            { path: 'src/auth/jwt.ts', category: 'source', contentExcerpt: 'export function signToken() { ... }' },
            { path: 'src/catalog/books.ts', category: 'source', contentExcerpt: 'export const getBooks = () => []' },
            { path: 'tests/auth.test.ts', category: 'test', contentExcerpt: 'describe("Auth", () => { ... })' },
          ],
          discoveredFilePaths: [
            'src/auth/jwt.ts',
            'src/catalog/books.ts',
            'tests/auth.test.ts',
            'Dockerfile',
            'package.json',
          ],
          detectedTechnologies: ['TypeScript', 'React', 'PostgreSQL', 'Docker'],
        };

    try {
      const response = await fetch('/api/investigate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: room.id,
          roomName: room.name,
          roomLayer: room.layer,
          roomStatus: room.status,
          roomEvidence: room.evidence,
          repoContext,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        if (data.code === 'CONFIG_REQUIRED') {
          setSetupRequired(true);
        } else {
          setErrorMessage(data.error || 'Investigation failed.');
        }
        return;
      }

      setFinding(data.finding || null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network failure';
      setErrorMessage(`Investigation request failed: ${msg}`);
    } finally {
      setIsInvestigating(false);
    }
  };

  const handleCopyPrompt = async () => {
    if (!finding?.generatedPrompt) return;
    try {
      await navigator.clipboard.writeText(finding.generatedPrompt);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2500);
    } catch {
      // Fallback if clipboard API is blocked
      const textArea = document.createElement('textarea');
      textArea.value = finding.generatedPrompt;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2500);
    }
  };

  return (
    <div
      className={`room-detail-panel ${finding ? 'expanded-investigation' : ''}`}
      role="region"
      aria-label="Room Architecture Inspector"
    >
      <div className="room-detail-header">
        <div>
          <div className="room-detail-title">{room.name}</div>
          <div
            style={{
              fontSize: '0.72rem',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
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
          {isSampleActive ? 'VERIFIED EVIDENCE (SAMPLE DATA):' : 'SCANNED EVIDENCE:'}
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

      {/* Action Button: Investigate This Room */}
      <div className="room-investigate-actions">
        <button
          type="button"
          className="btn-investigate-room"
          onClick={handleInvestigate}
          disabled={isInvestigating}
        >
          {isInvestigating ? (
            <span className="investigating-spin">⚡ Investigating {room.name}...</span>
          ) : (
            <span>🔍 Investigate this room</span>
          )}
        </button>
      </div>

      {/* Missing API Key Setup Banner */}
      {setupRequired && (
        <div className="room-setup-banner">
          <strong>AI Provider Key Required</strong>
          <p>
            Add <code>GEMINI_API_KEY</code> to your server environment or <code>.env</code> file to run
            investigations.
          </p>
        </div>
      )}

      {/* Error Banner */}
      {errorMessage && (
        <div className="room-error-banner" role="alert">
          <span>⚠️ {errorMessage}</span>
          <button
            type="button"
            className="btn-retry-investigate"
            onClick={handleInvestigate}
            disabled={isInvestigating}
          >
            Retry
          </button>
        </div>
      )}

      {/* Investigation Finding Card */}
      {finding && (
        <div className="investigation-finding-card" role="region" aria-label="Investigation Finding">
          <div className="finding-header">
            <h4 className="finding-title">{finding.title}</h4>
            <div className="finding-badges-row">
              <span className={`category-pill cat-${finding.category}`}>
                {finding.category.replace('_', ' ')}
              </span>
              <span className={`severity-pill sev-${finding.severity}`}>
                {finding.severity.toUpperCase()}
              </span>
              <span className={`classification-pill class-${finding.evidenceClassification}`}>
                {finding.evidenceClassification.toUpperCase()}
              </span>
            </div>
          </div>

          <p className="finding-explanation">{finding.explanation}</p>

          {/* Caveats / Uncertainties */}
          <div className="finding-uncertainties-box">
            <strong>Known vs Uncertain:</strong> {finding.uncertainties}
          </div>

          {/* Validated Evidence File References */}
          {finding.evidenceReferences.length > 0 && (
            <div className="finding-refs-section">
              <span className="finding-section-label">VALIDATED EVIDENCE REFERENCES:</span>
              <ul className="finding-refs-list">
                {finding.evidenceReferences.map((ref) => (
                  <li key={ref.path} className="finding-ref-item">
                    {ref.githubUrl ? (
                      <a
                        href={ref.githubUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="file-link"
                      >
                        <code>{ref.path}</code> ↗
                      </a>
                    ) : (
                      <code>{ref.path}</code>
                    )}
                    <span className="ref-inspection-badge">
                      {ref.isInspected ? 'Inspected in scan' : 'Discovered in tree (uninspected)'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Companion Dialogue */}
          {finding.companionMessages.length > 0 && (
            <div className="finding-dialogue-section">
              {finding.companionMessages.map((msg, idx) => (
                <div key={idx} className={`finding-companion-quote ${msg.speaker}`}>
                  <PixelPetAvatar speaker={msg.speaker} size={20} />
                  <div>
                    <span className="quote-speaker">
                      {msg.speaker === 'dog' ? 'Barkley:' : 'Cleo:'}
                    </span>{' '}
                    {msg.text}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Recommended Next Step */}
          <div className="finding-recommendation-box">
            <strong>Recommended Next Step:</strong> {finding.recommendedNextStep}
          </div>

          {/* Coding Agent Repair Prompt Section */}
          <div className="repair-prompt-controls">
            <button
              type="button"
              className="btn-toggle-prompt"
              onClick={() => setShowPrompt(!showPrompt)}
            >
              {showPrompt ? 'Hide repair prompt' : '⚡ Generate coding-agent repair prompt'}
            </button>

            {showPrompt && (
              <button
                type="button"
                className={`btn-copy-prompt ${copySuccess ? 'copied' : ''}`}
                onClick={handleCopyPrompt}
              >
                {copySuccess ? '✓ Copied to clipboard!' : '📋 Copy prompt for coding agent'}
              </button>
            )}
          </div>

          {showPrompt && finding.generatedPrompt && (
            <div className="prompt-display-container">
              <div className="prompt-meta-note">
                Copy and paste this self-contained prompt directly into Antigravity, Claude Code, or
                your coding agent:
              </div>
              <textarea
                className="repair-prompt-textarea"
                readOnly
                value={finding.generatedPrompt}
                rows={10}
              />
            </div>
          )}

          {/* Fix Reporting & Verification Lifecycle Section (T06) */}
          <FixLifecyclePanel
            finding={finding}
            room={room}
            scanResult={scanResult}
            isSampleActive={isSampleActive}
            onRoomUpdated={onRoomUpdated}
          />
        </div>
      )}
    </div>
  );
};
