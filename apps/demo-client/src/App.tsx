import { useRef, useState } from "react";
import type { LoadstarClient } from "@loadstar/client";
import { Chat } from "./components/chat";
import { TracePanel } from "./components/trace-panel";
import { Compass, Activity } from "lucide-react";

function App() {
  const [activeTraceId, setActiveTraceId] = useState<string>();
  const [traceOpen, setTraceOpen] = useState(true);
  const clientRef = useRef<LoadstarClient>();

  return (
    <div className="flex h-[100dvh] bg-background">
      {/* Chat panel */}
      <div className="flex flex-col flex-1 min-w-0 border-r">
        <header className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <div className="flex items-center gap-2 text-base font-semibold">
            <Compass className="h-5 w-5" />
            loadstar
            <span className="text-muted-foreground font-normal text-sm">
              demo
            </span>
          </div>
          <button
            onClick={() => setTraceOpen(!traceOpen)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-muted"
          >
            <Activity className="h-3.5 w-3.5" />
            {traceOpen ? "Hide" : "Show"} traces
          </button>
        </header>
        <Chat
          onTraceId={setActiveTraceId}
          clientRef={clientRef}
        />
      </div>

      {/* Trace panel */}
      {traceOpen && (
        <div className="w-[480px] shrink-0 border-l bg-card flex flex-col">
          <TracePanel
            client={clientRef.current ?? null}
            activeTraceId={activeTraceId}
          />
        </div>
      )}
    </div>
  );
}

export default App;
