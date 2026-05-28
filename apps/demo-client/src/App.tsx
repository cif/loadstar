import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LoadstarClient } from "@loadstar/client";
import { Chat } from "./components/chat";
import { TracePanel } from "./components/trace-panel";
import { MetricsDashboard } from "./components/metrics-dashboard";
import { ConversationList } from "./components/conversation-list";
import { Activity, ArrowLeft, BarChart3, Compass, MessageSquare } from "lucide-react";
import { cn } from "./lib/utils";

const API_URL = import.meta.env.VITE_API_URL ?? "";

type RightTab = "traces" | "metrics";

function App() {
  const [activeTraceId, setActiveTraceId] = useState<string>();
  const [rightTab, setRightTab] = useState<RightTab>("traces");
  const [conversationId, setConversationId] = useState<string>();
  const [sidebarSelectedId, setSidebarSelectedId] = useState<string>();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [client, setClient] = useState<LoadstarClient | null>(null);
  const clientRef = useRef<LoadstarClient>();

  useEffect(() => {
    const c = new LoadstarClient({ baseUrl: API_URL });
    clientRef.current = c;
    setClient(c);
  }, []);

  const handleSelectConversation = useCallback((id: string) => {
    setSidebarSelectedId(id);
    setConversationId(id);
  }, []);

  const handleNewConversation = useCallback(() => {
    setSidebarSelectedId(undefined);
    setConversationId(undefined);
  }, []);

  const handleConversationCreated = useCallback((id: string) => {
    setConversationId(id);
  }, []);

  return (
    <div className="flex h-[100dvh] bg-background">
      {sidebarOpen && (
        <div className="w-[220px] shrink-0 border-r flex flex-col">
          <ConversationList
            client={client}
            activeId={conversationId}
            onSelect={handleSelectConversation}
            onNew={handleNewConversation}
          />
        </div>
      )}

      <div className="flex flex-col flex-1 min-w-0 border-r">
        <header className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <div className="flex items-center gap-2">
            <Link to="/" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="h-3.5 w-3.5" />
              <Compass className="h-4 w-4" />
            </Link>
            <span className="text-base font-semibold">loadstar</span>
            <span className="text-muted-foreground font-normal text-sm">
              demo
            </span>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1 rounded-md hover:bg-muted transition-colors ml-2"
            >
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </header>
        <Chat
          key={sidebarSelectedId ?? "current"}
          onTraceId={setActiveTraceId}
          clientRef={clientRef}
          conversationId={conversationId}
          onConversationCreated={handleConversationCreated}
        />
      </div>

      <div className="w-[480px] shrink-0 flex flex-col bg-card">
        <div className="flex border-b shrink-0">
          <button
            onClick={() => setRightTab("traces")}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors border-b-2",
              rightTab === "traces"
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Activity className="h-3.5 w-3.5" />
            Traces
          </button>
          <button
            onClick={() => setRightTab("metrics")}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors border-b-2",
              rightTab === "metrics"
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            Metrics
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          {rightTab === "traces" ? (
            <TracePanel
              client={client}
              activeTraceId={activeTraceId}
            />
          ) : (
            <MetricsDashboard />
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
