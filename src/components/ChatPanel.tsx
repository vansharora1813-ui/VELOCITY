import React, { useState, useRef, useEffect } from 'react';
import { PixelPetAvatar } from './PixelPetAvatar.tsx';
import type { ArchitecturalRoom } from '../types.ts';
import type { CompanionReplyMessage, CompanionSpeaker } from '../server/types.ts';
import type { GitHubScanResult } from '../domain/github/types.ts';

export interface ChatMessageItem {
  id: string;
  sender: 'user' | CompanionSpeaker;
  text: string;
  timestamp: string;
  evidenceReference?: string;
}

interface ChatPanelProps {
  selectedRoom: ArchitecturalRoom | null;
  scanResult: GitHubScanResult | null;
  isSampleActive: boolean;
  rooms: ArchitecturalRoom[];
  initialMessages?: ChatMessageItem[];
  onMessagesChange?: (messages: ChatMessageItem[]) => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  selectedRoom,
  scanResult,
  isSampleActive,
  rooms,
  initialMessages,
  onMessagesChange,
}) => {
  const [messages, setMessages] = useState<ChatMessageItem[]>(() => {
    if (initialMessages && initialMessages.length > 0) {
      return initialMessages;
    }
    return [
      {
        id: 'init-dog',
        sender: 'dog',
        text: "Woof! I'm Barkley! Ask me anything about this repository's architecture, dependencies, or the rooms in the house!",
        timestamp: 'Ready',
      },
      {
        id: 'init-cat',
        sender: 'cat',
        text: "And I'm Cleo. I keep Barkley honest. I only accept real verified tests and evidence.",
        timestamp: 'Ready',
      },
    ];
  });

  const currentProjectKey = isSampleActive
    ? 'sample:booknook-demo'
    : `${scanResult?.owner}/${scanResult?.repo}@${scanResult?.commitSha ? scanResult.commitSha.slice(0, 7) : 'latest'}`;
  const prevProjectKeyRef = useRef(currentProjectKey);

  useEffect(() => {
    if (prevProjectKeyRef.current !== currentProjectKey) {
      prevProjectKeyRef.current = currentProjectKey;
      if (initialMessages && initialMessages.length > 0) {
        setMessages(initialMessages);
      } else {
        const resetMessages: ChatMessageItem[] = [
          {
            id: `reset-dog-${Date.now()}`,
            sender: 'dog',
            text: isSampleActive
              ? "Woof! Switched to sample BookNook repository. Previous conversation cleared."
              : `Woof! Switched project to ${currentProjectKey}. Previous conversation cleared. Ask me anything about this repository's architecture!`,
            timestamp: 'Reset',
          },
          {
            id: `reset-cat-${Date.now()}`,
            sender: 'cat',
            text: isSampleActive
              ? "Showing sample architecture. All claims will be matched against sample data."
              : `Project ${currentProjectKey} loaded. I will only accept real files and verified evidence from this scan.`,
            timestamp: 'Reset',
          },
        ];
        setMessages(resetMessages);
        onMessagesChange?.(resetMessages);
      }
      setErrorMessage(null);
      setSetupRequired(false);
    }
  }, [currentProjectKey, isSampleActive, initialMessages, onMessagesChange]);

  const updateAndNotifyMessages = (newMsgs: ChatMessageItem[]) => {
    setMessages(newMsgs);
    onMessagesChange?.(newMsgs);
  };

  const [inputVal, setInputVal] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const [failedMessage, setFailedMessage] = useState<string | null>(null);

  const handleSendMessage = async (textToSend: string, isRetry = false) => {
    const trimmed = textToSend.trim();
    if (!trimmed || isLoading) return;

    let newMessages = messages;
    let currentMessageId = '';

    if (!isRetry) {
      currentMessageId = `user-${Date.now()}`;
      const userMessageItem: ChatMessageItem = {
        id: currentMessageId,
        sender: 'user',
        text: trimmed,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      newMessages = [...messages, userMessageItem];
      updateAndNotifyMessages(newMessages);
      setInputVal('');
    } else {
      currentMessageId = messages[messages.length - 1]?.id || '';
    }

    setIsLoading(true);
    setErrorMessage(null);
    const requestProjectKey = currentProjectKey;

    // Build context payload from current scan / sample state
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
          roomSummaries: rooms.map((r) => ({
            id: r.id,
            name: r.name,
            layer: r.layer,
            status: r.status,
            evidence: r.evidence,
            filePaths: r.filePaths,
            ciStatus: r.metrics?.ciStatus,
            ciCheckName: r.metrics?.ciCheckName,
          })),
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
      : isSampleActive
      ? {
          owner: 'example',
          repo: 'booknook-demo',
          branch: 'main',
          totalFiles: 42,
          inspectedFiles: [
            {
              path: 'src/auth/jwt.ts',
              category: 'source',
              contentExcerpt: 'export function signToken(user: User): string { ... }',
            },
            {
              path: 'src/catalog/books.ts',
              category: 'source',
              contentExcerpt: 'export const getBooks = () => { return []; }',
            },
            {
              path: 'tests/auth.test.ts',
              category: 'test',
              contentExcerpt: 'describe("JWT authentication", () => { ... })',
            },
          ],
          discoveredFilePaths: ['src/auth/jwt.ts', 'src/catalog/books.ts', 'tests/auth.test.ts'],
          detectedTechnologies: ['TypeScript', 'React', 'PostgreSQL', 'Docker'],
          roomSummaries: rooms.map((r) => ({
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

    // Format bounded history
    const historyPayload = newMessages
      .slice(-6)
      .filter((m) => m.id !== currentMessageId)
      .map((m) => ({
        role: m.sender === 'user' ? ('user' as const) : ('assistant' as const),
        text: m.text,
        speaker: m.sender !== 'user' ? m.sender : undefined,
      }));

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          history: historyPayload,
          selectedRoomId: selectedRoom?.id,
          repoContext,
        }),
      });

      const data = await response.json();

      if (prevProjectKeyRef.current !== requestProjectKey) {
        // Discard late response if user switched repository during in-flight request
        return;
      }

      if (!response.ok || !data.success) {
        if (data.code === 'CONFIG_REQUIRED') {
          setSetupRequired(true);
        } else {
          setErrorMessage(data.error || 'Failed to communicate with AI provider.');
          setFailedMessage(trimmed);
        }
        return;
      }

      // Model returned valid replies (1 or 2 messages)
      const companionReplies: CompanionReplyMessage[] = data.replies || [];
      const replyItems: ChatMessageItem[] = companionReplies.map((r, idx) => ({
        id: `reply-${Date.now()}-${idx}`,
        sender: r.speaker,
        text: r.text,
        evidenceReference: r.evidenceReference,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }));

      const updatedMessages = [...newMessages, ...replyItems];
      updateAndNotifyMessages(updatedMessages);
      setFailedMessage(null);
    } catch (err: unknown) {
      if (prevProjectKeyRef.current !== requestProjectKey) {
        return;
      }
      const msg = err instanceof Error ? err.message : 'Network failure';
      setErrorMessage(`Request failed: ${msg}. You can retry.`);
      setFailedMessage(trimmed);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(inputVal);
    }
  };

  const handleClearChat = () => {
    setMessages([
      {
        id: 'reset-dog',
        sender: 'dog',
        text: "Clean slate! What part of the architecture should we inspect next?",
        timestamp: 'Ready',
      },
    ]);
    setErrorMessage(null);
  };

  return (
    <aside className="chat-panel-container" aria-label="AI Companions Group Chat">
      {/* Centred header at top of panel */}
      <div className="chat-panel-header">
        <div className="chat-companion-avatars-row">
          <div className="pet-header-avatar">
            <PixelPetAvatar speaker="dog" size={24} />
            <span className="pet-header-name">Barkley</span>
          </div>
          <span className="avatar-divider">&</span>
          <div className="pet-header-avatar">
            <PixelPetAvatar speaker="cat" size={24} />
            <span className="pet-header-name">Cleo</span>
          </div>
        </div>
        <div className="chat-panel-subheading">One model · Two distinct personalities</div>
      </div>

      {/* Setup notification if API key is not configured */}
      {setupRequired && (
        <div className="chat-setup-banner">
          <strong>AI Provider Key Required</strong>
          <p>
            To activate live companion dialogue, add <code>GEMINI_API_KEY</code> to your{' '}
            <code>.env</code> file on the server.
          </p>
        </div>
      )}

      {/* Quick context chip for selected room */}
      {selectedRoom && (
        <div className="chat-selected-room-bar">
          <span>Focusing on: <strong>{selectedRoom.name}</strong></span>
          <button
            type="button"
            className="btn-ask-room"
            onClick={() =>
              handleSendMessage(
                `Tell me about ${selectedRoom.name}: what evidence exists and what is missing?`
              )
            }
            disabled={isLoading}
          >
            Ask about this room →
          </button>
        </div>
      )}

      {/* Group Chat Messages Scrollable Stream */}
      <div className="chat-messages-scroll" role="log" aria-live="polite">
        {messages.map((msg) => {
          if (msg.sender === 'user') {
            return (
              <div key={msg.id} className="user-message-row">
                <div className="user-bubble">
                  <p className="message-body">{msg.text}</p>
                  <span className="user-timestamp">{msg.timestamp}</span>
                </div>
              </div>
            );
          }

          const isDog = msg.sender === 'dog';

          return (
            <div
              key={msg.id}
              className={`companion-group-row ${isDog ? 'companion-dog-row' : 'companion-cat-row'}`}
            >
              <div className="companion-avatar-col">
                <PixelPetAvatar speaker={msg.sender} size={30} />
              </div>
              <div className="companion-bubble-col">
                <div className="companion-bubble-header">
                  <span className="companion-name-label">
                    {isDog ? 'Barkley (Dog)' : 'Cleo (Cat)'}
                  </span>
                  <span className="companion-time-label">{msg.timestamp}</span>
                </div>
                <p className="message-body">{msg.text}</p>
                {msg.evidenceReference && (
                  <div className="evidence-ref-tag">
                    Ref: <code>{msg.evidenceReference}</code>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Genuine Typing Indicator while waiting for model */}
        {isLoading && (
          <div className="typing-indicator-row">
            <div className="typing-avatars">
              <PixelPetAvatar speaker="dog" size={22} isTyping />
              <PixelPetAvatar speaker="cat" size={22} isTyping />
            </div>
            <div className="typing-bubble">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Error Banner */}
      {errorMessage && (
        <div className="chat-error-toast" role="alert">
          <span className="chat-error-text">⚠️ {errorMessage}</span>
          {failedMessage && !setupRequired && (
            <button
              type="button"
              className="btn-retry-chat"
              onClick={() => handleSendMessage(failedMessage, true)}
              disabled={isLoading}
              title="Retry sending this message"
            >
              Retry
            </button>
          )}
          <button
            type="button"
            className="error-dismiss-btn"
            onClick={() => {
              setErrorMessage(null);
              setFailedMessage(null);
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Interactive Input Footer Area */}
      <div className="chat-input-area">
        <textarea
          ref={textareaRef}
          className="chat-input-box active-chat"
          placeholder="Ask Barkley & Cleo about this codebase... (Enter to send, Shift+Enter for newline)"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          rows={2}
          aria-label="Ask pet companions about repository architecture"
        />

        <div className="chat-input-actions">
          <button
            type="button"
            className="btn-clear-chat"
            onClick={handleClearChat}
            disabled={isLoading || messages.length <= 1}
            title="Clear conversation history"
          >
            Clear chat
          </button>

          <span className="chat-input-hint">Enter to send · Shift+Enter newline</span>

          <button
            type="button"
            className="btn-send-active"
            onClick={() => handleSendMessage(inputVal)}
            disabled={isLoading || !inputVal.trim()}
          >
            {isLoading ? 'Thinking...' : 'Send'}
          </button>
        </div>
      </div>
    </aside>
  );
};
