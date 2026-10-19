import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { ArchitecturalRoom } from '../types.ts';
import type { GitHubScanResult } from '../domain/github/types.ts';
import type { WorkflowDiagram, WorkflowNode } from '../server/types.ts';
import type { RoomInternalsData } from '../domain/workflow/roomInternalsEngine.ts';
import { validateWorkflowDiagram } from '../domain/workflow/workflowValidator.ts';
import { extractFunctionsFromSource, buildControlFlowGraph } from '../domain/cfg/index.ts';
import type { ControlFlowGraph } from '../domain/cfg/types.ts';
import { StaticSimulationWorkbench } from './StaticSimulationWorkbench.tsx';

// In-memory cache for room AI explanations to prevent duplicate requests
const roomExplanationCache = new Map<string, { text: string; diagram?: WorkflowDiagram }>();

export function clearRoomExplanationCache(): void {
  roomExplanationCache.clear();
}

interface RoomInternalsViewProps {
  room: ArchitecturalRoom;
  internalsData: RoomInternalsData;
  scanResult?: GitHubScanResult | null;
  isSampleActive?: boolean;
  allRooms?: ArchitecturalRoom[];
  onSelectRoom?: (roomId: string) => void;
}

export const RoomInternalsView: React.FC<RoomInternalsViewProps> = ({
  room,
  internalsData,
  scanResult = null,
  isSampleActive = false,
  allRooms = [],
  onSelectRoom,
}) => {
  const { recommendation, primaryArchetype } = internalsData;

  const [customAiFlow, setCustomAiFlow] = useState<WorkflowDiagram | null>(null);
  const [activeFlowIndex, setActiveFlowIndex] = useState(0);

  // Combine deterministic flows with optional AI-generated flow
  const allFlows = customAiFlow
    ? [customAiFlow, ...internalsData.flows]
    : internalsData.flows;

  const currentFlow: WorkflowDiagram | undefined = allFlows[activeFlowIndex] || allFlows[0];
  const nodes = currentFlow?.nodes || [];
  const edges = currentFlow?.edges || [];

  // Selected node state for detailed drilldown
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // T29: Static Simulation Workbench State
  const [viewMode, setViewMode] = useState<'diagram' | 'simulation'>('diagram');
  const [selectedCfg, setSelectedCfg] = useState<ControlFlowGraph | null>(null);

  // Extract real Control-Flow Graphs for functions in this room (T29)
  const roomCfgs = useMemo(() => {
    const list: ControlFlowGraph[] = [];
    if (!scanResult?.inspectedFiles) return list;
    const roomFileSet = new Set(room.filePaths?.map((p) => p.toLowerCase()) || []);
    for (const f of scanResult.inspectedFiles) {
      if (roomFileSet.has(f.path.toLowerCase()) && f.contentExcerpt) {
        try {
          const funcs = extractFunctionsFromSource(f.path, f.contentExcerpt);
          for (const fn of funcs) {
            const cfg = buildControlFlowGraph({
              sourcePath: f.path,
              content: f.contentExcerpt,
              functionName: fn.name,
              repositorySha: scanResult.commitSha,
            });
            if (cfg && cfg.nodes.length >= 2) {
              list.push(cfg);
            }
          }
        } catch {}
      }
    }
    return list;
  }, [scanResult, room.filePaths]);

  const knownTests = useMemo(() => {
    const tests: Array<{ testName: string; filePath: string; line?: number; passing?: boolean }> = [];
    if (!scanResult?.inspectedFiles) return tests;
    for (const f of scanResult.inspectedFiles) {
      if (f.category === 'test' || f.path.includes('.test.') || f.path.includes('.spec.')) {
        tests.push({
          testName: f.path.split('/').pop() || f.path,
          filePath: f.path,
        });
      }
    }
    return tests;
  }, [scanResult]);

  // Interactive Simulation State
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationStep, setSimulationStep] = useState(0);
  const simulationTimerRef = useRef<NodeJS.Timeout | null>(null);

  // AI Explain Internals State
  const [isExplaining, setIsExplaining] = useState(false);
  const [aiExplanationText, setAiExplanationText] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const cacheKey = `${scanResult?.owner || (isSampleActive ? 'sample' : 'unknown')}/${
    scanResult?.repo || 'repo'
  }@${scanResult?.commitSha || 'head'}#${room.id}`;

  // Reset states when switching room, repository, or scanned commit
  useEffect(() => {
    setActiveFlowIndex(0);
    setSelectedNodeId(null);
    setIsSimulating(false);
    setSimulationStep(0);
    setAiError(null);
    setViewMode('diagram');
    setSelectedCfg(null);

    const cached = roomExplanationCache.get(cacheKey);
    if (cached) {
      setAiExplanationText(cached.text);
      setCustomAiFlow(cached.diagram || null);
    } else {
      setAiExplanationText(null);
      setCustomAiFlow(null);
    }
  }, [room.id, scanResult?.owner, scanResult?.repo, scanResult?.commitSha, isSampleActive, cacheKey]);

  const activeNode: WorkflowNode | undefined =
    nodes.find((n) => n.id === (selectedNodeId || (isSimulating ? nodes[simulationStep]?.id : nodes[0]?.id))) ||
    nodes[0];

  // Auto-play simulation loop (1.8s cadence per stage)
  useEffect(() => {
    if (isSimulating) {
      simulationTimerRef.current = setTimeout(() => {
        setSimulationStep((prev) => {
          if (prev >= nodes.length - 1) {
            setIsSimulating(false);
            return prev;
          }
          return prev + 1;
        });
      }, 1800);
    } else if (simulationTimerRef.current) {
      clearTimeout(simulationTimerRef.current);
    }

    return () => {
      if (simulationTimerRef.current) clearTimeout(simulationTimerRef.current);
    };
  }, [isSimulating, simulationStep, nodes.length]);

  const handleStartSimulation = () => {
    if (roomCfgs.length > 0) {
      setSelectedCfg(roomCfgs[0]);
      setViewMode('simulation');
    } else {
      setSimulationStep(0);
      setIsSimulating(true);
      setSelectedNodeId(nodes[0]?.id || null);
    }
  };

  const handlePauseSimulation = () => {
    setIsSimulating(false);
  };

  const handleStepForward = () => {
    setIsSimulating(false);
    setSimulationStep((prev) => Math.min(nodes.length - 1, prev + 1));
    setSelectedNodeId(nodes[Math.min(nodes.length - 1, simulationStep + 1)]?.id || null);
  };

  const handleStepBack = () => {
    setIsSimulating(false);
    setSimulationStep((prev) => Math.max(0, prev - 1));
    setSelectedNodeId(nodes[Math.max(0, simulationStep - 1)]?.id || null);
  };

  const handleRestartSimulation = () => {
    setIsSimulating(false);
    setSimulationStep(0);
    setSelectedNodeId(nodes[0]?.id || null);
  };

  const handleSelectNode = (node: WorkflowNode, index: number) => {
    setIsSimulating(false);
    setSelectedNodeId(node.id);
    setSimulationStep(index);
  };

  const handleFocusRoom = (roomId?: string) => {
    if (roomId && onSelectRoom) {
      onSelectRoom(roomId);
    }
  };

  const handleExplainInternals = async () => {
    if (isExplaining) return;

    // Check cache
    const cached = roomExplanationCache.get(cacheKey);
    if (cached) {
      setAiExplanationText(cached.text);
      if (cached.diagram) {
        setCustomAiFlow(cached.diagram);
        setActiveFlowIndex(0);
      }
      return;
    }

    setIsExplaining(true);
    setAiError(null);

    const repoContext = !isSampleActive && scanResult
      ? {
          owner: scanResult.owner,
          repo: scanResult.repo,
          branch: scanResult.metadata?.defaultBranch || 'main',
          commitSha: scanResult.commitSha,
          totalFiles: scanResult.totalFilesDiscovered,
          inspectedFiles: scanResult.inspectedFiles.map((f) => ({
            path: f.path,
            category: f.category,
            contentExcerpt: f.contentExcerpt,
            sizeBytes: f.sizeBytes,
          })),
          discoveredFilePaths: scanResult.discoveredFilePaths || scanResult.inspectedFiles.map((f) => f.path),
          detectedTechnologies: scanResult.detectedTechnologies,
          roomSummaries: allRooms.map((r) => ({
            id: r.id,
            name: r.name,
            layer: r.layer,
            status: r.status,
            evidence: r.evidence,
            filePaths: r.filePaths,
            ciStatus: r.metrics?.ciStatus,
            ciCheckName: r.metrics?.ciCheckName,
          })),
        }
      : undefined;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Explain the internal architecture, key functions, and execution flow of room "${room.name}" in detail. Include a workflow diagram if possible.`,
          selectedRoomId: room.id,
          explanationLevel: 'intermediate',
          repoContext,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setAiError(data.error || 'AI internals explanation request failed.');
        return;
      }

      // Combine companion replies into readable prose
      const replies = Array.isArray(data.replies) ? data.replies : [];
      const explanationProse = replies.map((r: { text: string }) => r.text).join(' ');

      let validatedAiDiagram: WorkflowDiagram | undefined;
      if (data.workflowDiagram) {
        const sanitized = validateWorkflowDiagram(data.workflowDiagram, repoContext, {
          maxNodes: 12,
          maxEdges: 20,
        });
        if (sanitized) {
          validatedAiDiagram = {
            ...sanitized,
            title: `AI Deep-Dive: ${sanitized.title}`,
          };
          setCustomAiFlow(validatedAiDiagram);
          setActiveFlowIndex(0);
        }
      }

      setAiExplanationText(explanationProse);
      roomExplanationCache.set(cacheKey, {
        text: explanationProse,
        diagram: validatedAiDiagram,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error';
      setAiError(`AI explanation request failed: ${msg}. Existing structural data remains intact.`);
    } finally {
      setIsExplaining(false);
    }
  };

  const currentStepIndex = isSimulating
    ? simulationStep
    : nodes.findIndex((n) => n.id === activeNode?.id);

  // Inspect room file breakdown: distinguish inspected from discovered
  const inspectedPaths = new Set(
    (scanResult?.inspectedFiles || []).map((f) => f.path.toLowerCase())
  );
  const roomFiles = room.filePaths || [];

  return (
    <div className="room-internals-container" role="region" aria-label="Inside This Room Visualization">
      {/* Section Eyebrow and Header */}
      <div className="internals-header-row">
        <div className="internals-title-group">
          <span className="internals-eyebrow">INSIDE THIS ROOM</span>
          <h4 className="internals-room-title">{currentFlow?.title || `${room.name} Internals`}</h4>
        </div>

        <div className="internals-header-actions">
          <span className="archetype-badge" title={`Detected architectural structure: ${primaryArchetype}`}>
            {primaryArchetype.replace('_', ' ')}
          </span>

          <button
            type="button"
            className="btn-explain-internals"
            onClick={handleExplainInternals}
            disabled={isExplaining}
            title="Generate deep AI explanation and diagram for this room"
          >
            {isExplaining ? '⚡ Analyzing...' : '⚡ Explain internals'}
          </button>
        </div>
      </div>

      {/* AI Educational Explanation Callout (if generated) */}
      {aiExplanationText && (
        <div className="ai-internals-callout" role="region" aria-label="AI Internals Explanation">
          <div className="callout-header">
            <span className="callout-icon">💡</span>
            <strong className="callout-title">AI Deep-Dive Explanation:</strong>
          </div>
          <p className="callout-body">{aiExplanationText}</p>
        </div>
      )}

      {/* AI Error Banner (non-destructive) */}
      {aiError && (
        <div className="ai-internals-error" role="alert">
          <span>⚠️ {aiError}</span>
          <button
            type="button"
            className="btn-retry-ai-internals"
            onClick={handleExplainInternals}
            disabled={isExplaining}
          >
            Retry
          </button>
        </div>
      )}

      {/* Display Mode Toggle: Workflow Diagram vs Static Simulation Workbench (T29) */}
      <div className="internals-display-mode-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div className="diagram-display-mode-toggle" role="group" aria-label="Internals view mode">
          <button
            type="button"
            className={`btn-toggle-view ${viewMode === 'diagram' ? 'active' : ''}`}
            onClick={() => setViewMode('diagram')}
            title="View stage-by-stage workflow diagram"
          >
            🔄 Workflow Diagram
          </button>
          <button
            type="button"
            className={`btn-toggle-view ${viewMode === 'simulation' ? 'active' : ''}`}
            onClick={() => {
              if (roomCfgs.length > 0 && !selectedCfg) {
                setSelectedCfg(roomCfgs[0]);
              }
              setViewMode('simulation');
            }}
            title="Step through deterministic static simulation of code paths (T29)"
          >
            🔬 Static Simulation Workbench {roomCfgs.length > 0 ? `(${roomCfgs.length} CFGs)` : ''}
          </button>
        </div>
      </div>

      {viewMode === 'simulation' ? (
        <StaticSimulationWorkbench
          cfg={selectedCfg || roomCfgs[0] || null}
          availableCfgs={roomCfgs}
          onSelectCfg={(c) => setSelectedCfg(c)}
          knownTests={knownTests}
          onFocusRoom={onSelectRoom}
        />
      ) : (
        <>
          {/* Multiple Flow Tabs (if room has more than 1 flow) */}
          {allFlows.length > 1 && (
            <div className="internals-flow-tabs" role="tablist" aria-label="Room flow alternatives">
              {allFlows.map((flow, idx) => (
                <button
                  key={flow.id || idx}
                  type="button"
                  role="tab"
                  aria-selected={idx === activeFlowIndex}
                  className={`flow-tab-btn ${idx === activeFlowIndex ? 'active-tab' : ''}`}
                  onClick={() => {
                    setActiveFlowIndex(idx);
                    setSelectedNodeId(null);
                    setSimulationStep(0);
                    setIsSimulating(false);
                  }}
                >
                  {flow.title.split(': ')[1] || flow.title}
                </button>
              ))}
            </div>
          )}

          {/* Simulation Toolbar: Shown only when a valid flow exists */}
          {allFlows.length > 0 && nodes.length > 0 ? (
            <>
              <div className="simulation-toolbar">
                <div className="sim-buttons-group">
                  {isSimulating ? (
                    <button
                      type="button"
                      className="btn-sim-action btn-sim-pause"
                      onClick={handlePauseSimulation}
                      title="Pause flow simulation"
                    >
                      ⏸ Pause
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-sim-action btn-sim-play"
                      onClick={handleStartSimulation}
                      title="Visibly step through code-derived workflow or launch static simulation workbench"
                    >
                      ▶ Simulate Flow
                    </button>
                  )}

                  <button
                    type="button"
                    className="btn-sim-step"
                    onClick={handleStepBack}
                    disabled={currentStepIndex <= 0}
                    title="Step back to previous stage"
                  >
                    ◀ Back
                  </button>

                  <button
                    type="button"
                    className="btn-sim-step"
                    onClick={handleStepForward}
                    disabled={currentStepIndex >= nodes.length - 1}
                    title="Advance one stage"
                  >
                    Step ▶
                  </button>

                  <button
                    type="button"
                    className="btn-sim-restart"
                    onClick={handleRestartSimulation}
                    title="Reset simulation to beginning"
                  >
                    ↺ Reset
                  </button>
                </div>

                <div className="sim-status-hint">
                  {isSimulating ? (
                    <span className="sim-running-indicator">
                      ⚡ Simulating stage <strong>{simulationStep + 1}</strong> of <strong>{nodes.length}</strong>
                    </span>
                  ) : (
                    <span className="sim-paused-indicator">
                      Stage <strong>{Math.max(1, currentStepIndex + 1)}</strong> of <strong>{nodes.length}</strong>
                    </span>
                  )}
                </div>
              </div>

              {/* Visual SVG & Interactive Node Graph */}
              <div className="internals-graph-viewport">
                <div className="internals-sequence-row" role="list">
                  {nodes.map((node, idx) => {
                    const isSelected = node.id === activeNode?.id;
                    const isCurrentSimStep = idx === currentStepIndex;
                    const isObserved = node.classification === 'observed';

                    const nextNode = nodes[idx + 1];
                    const connectingEdge = nextNode
                      ? edges.find((e) => e.from === node.id && e.to === nextNode.id)
                      : undefined;

                    return (
                      <React.Fragment key={node.id}>
                        {/* Node Box */}
                        <div
                          role="listitem"
                          className={`internals-node-card ${isSelected ? 'selected-card' : ''} ${
                            isCurrentSimStep ? 'sim-active-card' : ''
                          } ${isObserved ? 'observed-card' : 'inferred-card'} node-type-${node.nodeType || 'component'}`}
                          onClick={() => handleSelectNode(node, idx)}
                          title={`Click to inspect details for ${node.label} (${node.classification})`}
                        >
                          <div className="node-card-top">
                            <span className="node-number-pill">{idx + 1}</span>
                            <span className={`node-type-label type-${node.nodeType || 'comp'}`}>
                              {node.nodeType || 'component'}
                            </span>
                            <span className={`node-badge-tag ${isObserved ? 'tag-obs' : 'tag-inf'}`}>
                              {isObserved ? 'Observed' : 'Inferred'}
                            </span>
                          </div>

                          <div className="node-card-title">{node.label}</div>
                          {node.role && <div className="node-card-role">{node.role}</div>}
                        </div>

                        {/* Connecting Edge Arrow */}
                        {idx < nodes.length - 1 && (
                          <div
                            className={`internals-edge-connector ${
                              idx === currentStepIndex || idx === currentStepIndex - 1 ? 'edge-highlighted' : ''
                            }`}
                          >
                            <svg className="connector-svg" width="36" height="18" viewBox="0 0 36 18" fill="none">
                              <line
                                x1="2"
                                y1="9"
                                x2="28"
                                y2="9"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeDasharray={connectingEdge?.classification === 'inferred' ? '3 3' : undefined}
                              />
                              <polygon points="26,5 34,9 26,13" fill="currentColor" />
                            </svg>

                            {connectingEdge?.label && (
                              <span className="connector-label-tag" title={connectingEdge.label}>
                                {connectingEdge.label}
                              </span>
                            )}

                            {connectingEdge?.branchLabel && (
                              <span className="connector-branch-tag" title={connectingEdge.branchLabel}>
                                {connectingEdge.branchLabel}
                              </span>
                            )}
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>

              {/* Selected Node Details Card */}
              {activeNode && (
                <div className="node-details-card" role="region" aria-label="Component Details">
                  <div className="node-details-header">
                    <div className="details-header-title">
                      <span className="details-eyebrow">STAGE {currentStepIndex + 1} DETAILS</span>
                      <h5 className="details-name">{activeNode.label}</h5>
                    </div>

                    <div className="details-badges">
                      <span className={`pill-badge ${activeNode.classification === 'observed' ? 'pill-obs' : 'pill-inf'}`}>
                        {activeNode.classification === 'observed' ? '✓ Observed Code' : '○ Inferred Architecture'}
                      </span>
                      {activeNode.roomId && (
                        <button
                          type="button"
                          className="btn-crosslink-room"
                          onClick={() => handleFocusRoom(activeNode.roomId)}
                          title={`Focus mapped room "${activeNode.roomId}" in isometric house`}
                        >
                          Focus Room in House ↗
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="node-details-grid">
                    <div className="details-grid-item">
                      <span className="item-label">Responsibility:</span>
                      <span className="item-value">{activeNode.description}</span>
                    </div>

                    <div className="details-grid-item">
                      <span className="item-label">What Enters:</span>
                      <span className="item-value">{activeNode.inputs || 'Input data / request'}</span>
                    </div>

                    <div className="details-grid-item">
                      <span className="item-label">What Leaves:</span>
                      <span className="item-value">{activeNode.outputs || 'Processed state / response'}</span>
                    </div>

                    {activeNode.importance && (
                      <div className="details-grid-item">
                        <span className="item-label">Why It Matters:</span>
                        <span className="item-value">{activeNode.importance}</span>
                      </div>
                    )}

                    {activeNode.filePath && (
                      <div className="details-grid-item full-width">
                        <span className="item-label">Supporting File:</span>
                        <span className="item-value code-ref">
                          <code>{activeNode.filePath}</code>
                          {activeNode.codeSnippet?.line && (
                            <span className="line-hint"> (Line {activeNode.codeSnippet.line})</span>
                          )}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Validated Code Excerpt */}
                  {activeNode.codeSnippet && (
                    <div className="node-code-snippet-box">
                      <div className="snippet-header">
                        <span>Validated Code Excerpt:</span>
                        <code>{activeNode.filePath}</code>
                      </div>
                      <pre className="snippet-pre">
                        <code>{activeNode.codeSnippet.code}</code>
                      </pre>
                      {activeNode.codeSnippet.explanation && (
                        <div className="snippet-explanation">{activeNode.codeSnippet.explanation}</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            /* Honest Limited Coverage State when no flow could be established */
            <div className="room-internals-limited-coverage" role="note">
              <span className="limited-coverage-badge">LIMITED COVERAGE</span>
              <h5 className="limited-coverage-title">No Source Code Inspected for {room.name}</h5>
              <p className="limited-coverage-text">
                {recommendation.roomResponsibilities}
              </p>
              <div className="limited-coverage-suggestion">
                <strong>Known vs Unknown:</strong> {recommendation.internalFlowSummary}
              </div>
            </div>
          )}
        </>
      )}

      {/* Governing Conditions & Outcomes (for Validation & Logic Rooms) */}
      {recommendation.governingConditions && recommendation.governingConditions.length > 0 && (
        <div className="governing-conditions-panel">
          <span className="conditions-section-title">GOVERNING CONDITIONS & OUTCOMES:</span>
          <div className="conditions-table">
            <div className="conditions-table-header">
              <span>Input / Condition Check</span>
              <span>Outcome Behavior</span>
              <span>Status</span>
            </div>
            {recommendation.governingConditions.map((cond, idx) => (
              <div key={idx} className="conditions-table-row">
                <code className="condition-expr">{cond.condition}</code>
                <span className="condition-outcome">{cond.outcome}</span>
                <span className={`condition-tag ${cond.isObserved ? 'obs' : 'inf'}`}>
                  {cond.isObserved ? 'Observed' : 'Inferred'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Associated Files Breakdown: Distinguish Inspected from Discovered */}
      {roomFiles.length > 0 && (
        <div className="room-files-breakdown-panel">
          <span className="rec-section-title">ASSOCIATED REPOSITORY FILES ({roomFiles.length}):</span>
          <div className="files-breakdown-list">
            {roomFiles.map((fp) => {
              const isObs = inspectedPaths.has(fp.toLowerCase());
              return (
                <div key={fp} className="file-breakdown-row">
                  <span className="file-icon">📄</span>
                  <code className="file-breakdown-path">{fp}</code>
                  <span className={`file-badge ${isObs ? 'badge-inspected' : 'badge-discovered'}`}>
                    {isObs ? '✓ Inspected Source' : '○ Discovered (Tree only)'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Context-Aware AI Recommendations for this Room */}
      <div className="room-recommendations-panel">
        <span className="rec-section-title">ROOM ARCHITECTURAL ASSESSMENT & RECOMMENDATIONS:</span>

        <div className="rec-summary-row">
          <div className="rec-summary-block">
            <strong>Core Responsibilities:</strong> {recommendation.roomResponsibilities}
          </div>
          <div className="rec-summary-block">
            <strong>Next Action:</strong> {recommendation.recommendedNextStep}
          </div>
        </div>

        {/* Observed Code Facts vs Inferred vs Unverified Risks */}
        <div className="rec-evidence-breakdown">
          {recommendation.observedFacts.length > 0 && (
            <div className="rec-facts-col">
              <span className="rec-col-label observed">✓ Observed Code Facts ({recommendation.observedFacts.length})</span>
              <ul>
                {recommendation.observedFacts.map((fact, idx) => (
                  <li key={idx}>{fact}</li>
                ))}
              </ul>
            </div>
          )}

          {recommendation.unverifiedRisks.length > 0 && (
            <div className="rec-facts-col">
              <span className="rec-col-label risks">⚠️ Unverified Risks & Gaps ({recommendation.unverifiedRisks.length})</span>
              <ul>
                {recommendation.unverifiedRisks.map((risk, idx) => (
                  <li key={idx}>{risk}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {recommendation.inspectionSuggestion && (
          <div className="inspection-suggestion-banner">
            💡 <strong>Inspection Suggestion:</strong> {recommendation.inspectionSuggestion}
          </div>
        )}
      </div>

      {/* Disclaimed Static Simulation Banner */}
      <div className="simulation-disclaimer-footer">
        <span>ℹ️ <strong>Static Flow Simulation:</strong> Derived from scanned repository code and deterministic evidence. Does not execute repository code or live server runtimes.</span>
      </div>
    </div>
  );
};
