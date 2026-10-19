import React, { useState, useEffect } from 'react';
import type { ArchitecturalRoom } from '../types.ts';
import type { GitHubScanResult } from '../domain/github/types.ts';
import type { RoomInvestigationFinding } from '../domain/investigation/types.ts';
import type { FixLifecycleState } from '../domain/lifecycle/types.ts';
import { PixelPetAvatar } from './PixelPetAvatar.tsx';
import { FixLifecyclePanel } from './FixLifecyclePanel.tsx';

interface RoomInspectorProps {
  room: ArchitecturalRoom | null;
  onClose: () => void;
  scanResult: GitHubScanResult | null;
  isSampleActive: boolean;
  onRoomUpdated?: (updatedRoom: ArchitecturalRoom) => void;
  savedFinding?: RoomInvestigationFinding | null;
  onFindingChange?: (roomId: string, finding: RoomInvestigationFinding | null) => void;
  savedLifecycleState?: FixLifecycleState | null;
  onLifecycleChange?: (roomId: string, state: FixLifecycleState | null) => void;
}

export const RoomInspector: React.FC<RoomInspectorProps> = ({
  room,
  onClose,
  scanResult,
  isSampleActive,
  onRoomUpdated,
  savedFinding,
  onFindingChange,
  savedLifecycleState,
  onLifecycleChange,
}) => {
  const [isInvestigating, setIsInvestigating] = useState(false);
  const [finding, setFinding] = useState<RoomInvestigationFinding | null>(savedFinding || null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [showPrompt, setShowPrompt] = useState(Boolean(savedFinding?.generatedPrompt));
  const [copySuccess, setCopySuccess] = useState(false);

  const activeTargetRef = React.useRef<{ roomId: string; commitSha?: string }>({
    roomId: room?.id || '',
    commitSha: scanResult?.commitSha,
  });

  // Restore or clear investigation and prompt state when switching rooms, repository, or scanned commit
  useEffect(() => {
    activeTargetRef.current = {
      roomId: room?.id || '',
      commitSha: scanResult?.commitSha,
    };
    setFinding(savedFinding || null);
    setErrorMessage(null);
    setSetupRequired(false);
    setShowPrompt(Boolean(savedFinding?.generatedPrompt));
    setCopySuccess(false);
  }, [room?.id, scanResult?.owner, scanResult?.repo, scanResult?.commitSha, isSampleActive, savedFinding]);

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
            sizeBytes: f.sizeBytes,
          })),
          discoveredFilePaths: scanResult.discoveredFilePaths || scanResult.inspectedFiles.map((f) => f.path),
          detectedTechnologies: scanResult.detectedTechnologies,
          dependencies: room.dependencies,
          ciEvaluation: scanResult.ciEvaluation
            ? {
                status:
                  scanResult.ciEvaluation.outcome === 'failed'
                    ? 'failing'
                    : scanResult.ciEvaluation.outcome === 'verified'
                    ? 'passing'
                    : 'inconclusive',
                isVerified: scanResult.ciEvaluation.outcome === 'verified',
                reason: scanResult.ciEvaluation.outcomeReason,
                checkRunsCount: scanResult.ciEvaluation.relevantTestChecks.length,
                failedChecks: scanResult.ciEvaluation.relevantTestChecks
                  .filter((c) => c.conclusion === 'failure' || c.conclusion === 'timed_out')
                  .map((c) => c.name),
              }
            : undefined,
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

    const targetRoomId = room.id;
    const targetCommitSha = scanResult?.commitSha;

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
          roomFilePaths: room.filePaths,
          repoContext,
        }),
      });

      const data = await response.json();

      // Discard late response if user switched room or commit while request was in-flight
      if (
        activeTargetRef.current.roomId !== targetRoomId ||
        activeTargetRef.current.commitSha !== targetCommitSha
      ) {
        return;
      }

      if (!response.ok || !data.success) {
        if (data.code === 'CONFIG_REQUIRED') {
          setSetupRequired(true);
        } else {
          setErrorMessage(data.error || 'Investigation failed.');
        }
        return;
      }

      const newFinding = data.finding || null;
      setFinding(newFinding);
      if (room?.id && onFindingChange) {
        onFindingChange(room.id, newFinding);
      }
    } catch (err: unknown) {
      if (
        activeTargetRef.current.roomId !== targetRoomId ||
        activeTargetRef.current.commitSha !== targetCommitSha
      ) {
        return;
      }
      const msg = err instanceof Error ? err.message : 'Network failure';
      setErrorMessage(`Investigation request failed: ${msg}. You can retry.`);
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
        {room.metrics.testFilesCount !== undefined ? (
          <span>Test files detected: {room.metrics.testFilesCount}</span>
        ) : null}
        {room.metrics.testsPassed !== undefined && room.metrics.totalTests !== undefined ? (
          <span>
            Tests executed: {room.metrics.testsPassed}/{room.metrics.totalTests} passing
          </span>
        ) : room.metrics.testFilesCount !== undefined ? (
          <span>
            Execution: {room.metrics.ciStatus === 'failing' ? 'Failing in CI' : room.metrics.ciStatus === 'passing' ? 'Passing in CI' : room.metrics.ciStatus === 'pending' ? 'In progress in CI' : 'not verified'}
          </span>
        ) : null}
        {room.metrics.ciStatus && (
          <span className={`ci-badge-status ci-${room.metrics.ciStatus}`}>
            CI: {room.metrics.ciStatus === 'failing' ? 'failing' : room.metrics.ciStatus === 'passing' ? 'passing' : room.metrics.ciStatus === 'pending' ? 'pending' : room.metrics.ciStatus === 'not_run' ? 'not run' : 'unavailable'}
            {room.metrics.ciCheckName ? ` (${room.metrics.ciCheckName})` : ''}
            {room.metrics.ciUrl && (
              <a
                href={room.metrics.ciUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={room.metrics.ciCheckName || 'View GitHub CI run'}
                style={{ marginLeft: 6, color: 'inherit', textDecoration: 'underline' }}
              >
                ↗
              </a>
            )}
          </span>
        )}
      </div>

      {/* Detected Dependencies */}
      {room.dependencies && room.dependencies.length > 0 && (
        <div className="room-detail-dependencies" style={{ marginBottom: 10 }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase' }}>
            Derived Dependencies ({room.dependencies.length}):
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {room.dependencies.map((dep) => (
              <span
                key={dep}
                style={{
                  background: '#2B2220',
                  border: '1px solid #483835',
                  color: '#D4C5B9',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  fontSize: '0.72rem',
                  fontFamily: 'ui-monospace, monospace',
                }}
              >
                {dep}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Associated Scanned Repository Files */}
      {room.filePaths && room.filePaths.length > 0 && (
        <div className="room-detail-file-paths" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase' }}>
            Associated Real Files ({room.filePaths.length}):
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              maxHeight: '100px',
              overflowY: 'auto',
              background: 'rgba(0, 0, 0, 0.25)',
              padding: '6px 8px',
              borderRadius: '4px',
              border: '1px solid #3A2E2C',
            }}
          >
            {room.filePaths.map((fp) => (
              <span
                key={fp}
                style={{
                  fontSize: '0.75rem',
                  fontFamily: 'ui-monospace, monospace',
                  color: '#E0D4CC',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                  overflow: 'hidden',
                }}
                title={fp}
              >
                📄 {fp}
              </span>
            ))}
          </div>
        </div>
      )}

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

          {/* Evidence Limitation / Downgrade Honest Notice */}
          {finding.evidenceClassification !== 'observed' && (
            <div className="finding-uncertainty-banner" role="status">
              ℹ️ <strong>Result Classification: {finding.evidenceClassification.toUpperCase()}</strong>.
              {finding.evidenceClassification === 'inferred'
                ? ' This diagnosis is derived by architectural inference because exact verified source files or failing CI logs were not directly observed.'
                : ' Grounding is limited by missing or uninspected files. Review actual source before acting.'}
            </div>
          )}

          {finding.rejectedReferences && finding.rejectedReferences.length > 0 && (
            <div className="finding-uncertainty-banner" role="status">
              ⚠️ <strong>Ungrounded Files Excluded:</strong> {finding.rejectedReferences.join(', ')} do not exist in the repository tree and were stripped from evidence.
            </div>
          )}

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
            savedLifecycleState={savedLifecycleState}
            onLifecycleChange={(state) => room && onLifecycleChange?.(room.id, state)}
          />
        </div>
      )}
    </div>
  );
};
