import React, { useState } from 'react';
import { Header } from './components/Header';
import { IsometricHouse } from './components/IsometricHouse';
import { RoomInspector } from './components/RoomInspector';
import { ChatPanel } from './components/ChatPanel';
import { SAMPLE_ROOMS, PREVIEW_CHAT_MESSAGES } from './data/sampleData';
import { ArchitecturalRoom } from './types';

export const App: React.FC = () => {
  const [rooms] = useState<ArchitecturalRoom[]>(SAMPLE_ROOMS);
  const [selectedRoom, setSelectedRoom] = useState<ArchitecturalRoom | null>(SAMPLE_ROOMS[0]);

  const handleSelectRoom = (room: ArchitecturalRoom) => {
    if (selectedRoom?.id === room.id) {
      setSelectedRoom(null);
    } else {
      setSelectedRoom(room);
    }
  };

  return (
    <div className="app-shell">
      <Header />

      <main className="app-body">
        {/* Center / Left: Interactive Software Architecture House */}
        <section className="workspace-house-container" aria-label="Architecture House Workspace">
          <div className="workspace-toolbar">
            <div className="toolbar-title">
              <span>Interactive Architecture Map</span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                (Click any room to inspect verified evidence)
              </span>
            </div>

            {/* Status Legend */}
            <div className="house-legend" role="note" aria-label="Room Status Legend">
              <div className="legend-item">
                <span className="legend-swatch verified" />
                <span>Verified</span>
              </div>
              <div className="legend-item">
                <span className="legend-swatch progress" />
                <span>In Progress</span>
              </div>
              <div className="legend-item">
                <span className="legend-swatch planned" />
                <span>Planned</span>
              </div>
              <div className="legend-item">
                <span className="legend-swatch blocked" />
                <span>Blocked</span>
              </div>
            </div>
          </div>

          <div className="svg-canvas-wrapper">
            <IsometricHouse
              rooms={rooms}
              selectedRoomId={selectedRoom?.id ?? null}
              onSelectRoom={handleSelectRoom}
            />

            <RoomInspector
              room={selectedRoom}
              onClose={() => setSelectedRoom(null)}
            />
          </div>
        </section>

        {/* Right side: Persistent Chat Panel */}
        <ChatPanel messages={PREVIEW_CHAT_MESSAGES} />
      </main>
    </div>
  );
};

export default App;
