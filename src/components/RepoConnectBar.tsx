import React, { useState } from 'react';
import type { GitHubScanResult, ScanStage } from '../domain/github/types.ts';
import { scanGitHubRepository } from '../domain/github/scanner.ts';

interface RepoConnectBarProps {
  onScanComplete: (result: GitHubScanResult) => void;
  onResetSample: () => void;
  isSampleActive: boolean;
  onOpenDetails: () => void;
  lastScanResult: GitHubScanResult | null;
}

export const RepoConnectBar: React.FC<RepoConnectBarProps> = ({
  onScanComplete,
  onResetSample,
  isSampleActive,
  onOpenDetails,
  lastScanResult,
}) => {
  const [urlInput, setUrlInput] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [stageMessage, setStageMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;

    setErrorMessage(null);
    setIsScanning(true);
    setStageMessage('Initiating scan...');

    try {
      const result = await scanGitHubRepository(
        urlInput,
        { maxFilesToInspect: 12 },
        (_stage: ScanStage, msg: string) => {
          setStageMessage(msg);
        }
      );

      if (!result.success) {
        setErrorMessage(result.error || 'Repository scan failed.');
      } else {
        onScanComplete(result);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error during scan';
      setErrorMessage(msg);
    } finally {
      setIsScanning(false);
      setStageMessage('');
    }
  };

  return (
    <div className="repo-connect-bar" role="region" aria-label="GitHub Repository Connection">
      <form onSubmit={handleScan} className="repo-input-form">
        <div className="input-group">
          <input
            type="text"
            className="repo-url-input"
            placeholder="https://github.com/owner/repository"
            value={urlInput}
            onChange={(e) => {
              setUrlInput(e.target.value);
              if (errorMessage) setErrorMessage(null);
            }}
            disabled={isScanning}
            aria-label="Public GitHub repository URL"
          />
          <button
            type="submit"
            className="btn-scan"
            disabled={isScanning || !urlInput.trim()}
          >
            {isScanning ? 'Scanning...' : 'Scan repository'}
          </button>
        </div>

        {!isSampleActive && (
          <button
            type="button"
            className="btn-reset-sample"
            onClick={onResetSample}
            disabled={isScanning}
            title="Switch back to BookNook demonstration dataset"
          >
            Reset to Sample Data (BookNook)
          </button>
        )}

        {lastScanResult && lastScanResult.success && (
          <button
            type="button"
            className="btn-view-telemetry"
            onClick={onOpenDetails}
            title="Inspect scan coverage and files inspected"
          >
            View Scan Telemetry ({lastScanResult.inspectedFiles.length} files)
          </button>
        )}
      </form>

      {/* Helper text explaining limitations */}
      <div className="repo-connect-help">
        <span>Public repositories only · GitHub API rate limit: 60 req/hr · Bounded to 12 representative files</span>
        {isScanning && <span className="scan-progress-indicator">⚡ {stageMessage}</span>}
      </div>

      {/* Error banner */}
      {errorMessage && (
        <div className="repo-error-banner" role="alert">
          <span className="error-icon">⚠️</span>
          <span>{errorMessage}</span>
          <button
            type="button"
            className="error-dismiss-btn"
            onClick={() => setErrorMessage(null)}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
};
