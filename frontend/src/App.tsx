import { useWebSocket } from './hooks/useWebSocket';
import { useStatusSync } from './hooks/useStatusSync';
import { TopBar } from './components/Layout/TopBar';
import { Sidebar } from './components/Layout/Sidebar';
import { MessageTable } from './components/MessageTable/MessageTable';
import { BottomPanel } from './components/Layout/BottomPanel';

export function App() {
  // Sync UI connection state from backend on mount + focus
  useStatusSync();

  // WebSocket lifecycle (connects when status becomes 'connected')
  useWebSocket();

  return (
    <div className="app-shell">
      <TopBar />
      <Sidebar />
      <MessageTable />
      <BottomPanel />
    </div>
  );
}
