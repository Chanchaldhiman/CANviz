import { useWebSocket } from './hooks/useWebSocket';
import { TopBar } from './components/Layout/TopBar';
import { Sidebar } from './components/Layout/Sidebar';
import { MessageTable } from './components/MessageTable/MessageTable';
import { BottomPanel } from './components/Layout/BottomPanel';

export function App() {
  // Starts the WebSocket lifecycle tied to connection status
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
