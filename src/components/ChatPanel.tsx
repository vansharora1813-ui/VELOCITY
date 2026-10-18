import React from 'react';
import { ChatMessagePreview } from '../types';

interface ChatPanelProps {
  messages: ChatMessagePreview[];
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ messages }) => {
  return (
    <aside className="chat-panel-container" aria-label="AI Companions Chat Panel">
      {/* Centred heading at the top of the panel */}
      <div className="chat-panel-header">
        <h2 className="chat-panel-heading">AI Companions</h2>
        <div className="chat-panel-subheading">Barkley (Dog) & Cleo (Cat)</div>
      </div>

      {/* Explicit UI Preview Notice */}
      <div className="chat-banner-preview">
        <strong>Preview Mode:</strong> Live AI is not connected yet. Real multi-persona dialogue powered by a unified LLM backend will be wired in future milestones.
      </div>

      {/* Conversation preview list */}
      <div className="chat-messages-scroll" role="log" aria-live="polite">
        {messages.map((msg) => (
          <article
            key={msg.id}
            className={`companion-message ${msg.sender === 'dog' ? 'dog-style' : 'cat-style'}`}
          >
            <div className="message-meta">
              <div className="companion-identity">
                <div
                  className="companion-avatar"
                  aria-hidden="true"
                  title={msg.sender === 'dog' ? 'Dog companion' : 'Cat companion'}
                >
                  {msg.sender === 'dog' ? '🐶' : '🐱'}
                </div>
                <div>
                  <div className="companion-name">{msg.speakerName}</div>
                  <div className="companion-tagline">{msg.tagline}</div>
                </div>
              </div>
              <time className="message-timestamp">{msg.timestamp}</time>
            </div>
            <p className="message-body">{msg.content}</p>
          </article>
        ))}
      </div>

      {/* Chat Input Area (Explicitly disabled UI preview) */}
      <div className="chat-input-area">
        <textarea
          className="chat-input-box"
          disabled
          aria-disabled="true"
          placeholder="Companions are offline. Connect an AI provider in future milestones to chat..."
          value=""
          readOnly
        />
        <div className="chat-input-actions">
          <span className="chat-input-hint">UI Preview Only · Input Disabled</span>
          <button
            type="button"
            className="btn-send-disabled"
            disabled
            title="Chat disabled until AI provider is connected"
          >
            Send
          </button>
        </div>
      </div>
    </aside>
  );
};
