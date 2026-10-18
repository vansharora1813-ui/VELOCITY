import React, { useState } from 'react';
import { Header } from './components/Header';
import { RepoConnectBar } from './components/RepoConnectBar';
import { ScanDetailsDrawer } from './components/ScanDetailsDrawer';
import { IsometricHouse } from './components/IsometricHouse';
import { RoomInspector } from './components/RoomInspector';
import { ChatPanel } from './components/ChatPanel';
import { SAMPLE_ROOMS, SAMPLE_PROJECT } from './data/sampleData';
import { mapScanResultToHouse } from './domain/github/architectureMapper';
import type { GitHubScanResult } from './domain/github/types';
import type { ArchitecturalRoom } from './types';

export const App: React.FC = () => {
  const [rooms, setRooms] = useState<ArchitecturalRoom[]>(SAMPLE_ROOMS);
  const [selectedRoom, setSelectedRoom] = useState<ArchitecturalRoom | null>(SAMPLE_ROOMS[0]);
  const [isSampleActive, setIsSampleActive] = useState<boolean>(true);
  const [lastScanResult, setLastScanResult] = useState<GitHubScanResult | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);

  const handleSelectRoom = (room: ArchitecturalRoom) => {
    if (selectedRoom?.id === room.id) {
      setSelectedRoom(null);
    } else {
      setSelectedRoom(room);
    }
  };

  const handleScanComplete = (result: GitHubScanResult) => {
    setLastScanResult(result);
    setIsSampleActive(false);

    const mapped = mapScanResultToHouse(result);
    setRooms(mapped.rooms);
    setSelectedRoom(mapped.rooms[0] || null);
  };

  const handleResetSample = () => {
    setRooms(SAMPLE_ROOMS);
    setSelectedRoom(SAMPLE_ROOMS[0]);
    setIsSampleActive(true);
    setLastScanResult(null);
    setIsDrawerOpen(false);
  };

  const currentSourceName = isSampleActive
    ? SAMPLE_PROJECT.name
    : `${lastScanResult?.owner}/${lastScanResult?.repo}`;

  return (
    <div className="app-shell">
      <Header
        sourceName={currentSourceName}
        sourceStatusLabel={isSampleActive ? SAMPLE_PROJECT.statusLabel : undefined}
        isRealRepo={!isSampleActive}
        branchName={lastScanResult?.metadata?.defaultBranch}
        scanStatus={lastScanResult?.status}
      />

      <RepoConnectBar
        onScanComplete={handleScanComplete}
        onResetSample={handleResetSample}
        isSampleActive={isSampleActive}
        onOpenDetails={() => setIsDrawerOpen(true)}
        lastScanResult={lastScanResult}
      />

      <main className="app-body">
        {/* Center / Left: Interactive Software Architecture House */}
        <section className="workspace-house-container" aria-label="Architecture House Workspace">
          <div className="workspace-toolbar">
            <div className="toolbar-title">
              <span>Interactive Architecture Map</span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                ({isSampleActive ? 'Sample Data' : 'Real Scanned Repository'} · Click any room to inspect evidence)
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
                <span>Implemented</span>
              </div>
              <div className="legend-item">
                <span className="legend-swatch planned" />
                <span>Planned</span>
              </div>
              <div className="legend-item">
                <span className="legend-swatch blocked" />
                <span>Blocked</span>
              </div>
              <div className="legend-item">
                <span className="legend-swatch unknown" />
                <span>Unknown</span>
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
        <ChatPanel
          selectedRoom={selectedRoom}
          scanResult={lastScanResult}
          isSampleActive={isSampleActive}
          rooms={rooms}
        />
      </main>

      {/* Telemetry & Inspected Files Drawer */}
      <ScanDetailsDrawer
        scanResult={lastScanResult}
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
      />
    </div>
  );
};

export default App;
