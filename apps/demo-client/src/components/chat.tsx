import { useCallback, useEffect, useRef, useState } from "react";
import { LoadstarClient } from "@loadstar/client";
import type { AgentEvent, Message } from "@loadstar/client";
import { CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatMessage } from "./chat-message";
import { ChatInput } from "./chat-input";
import { StatusIndicator } from "./status-indicator";
import { Compass } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8787";
const AGENT_NAME = import.meta.env.VITE_AGENT_NAME || "researcher";

type Status = "idle" | "thinking" | "tool" | "error";

interface ChatProps {
  onTraceId?: (traceId: string) => void;
  clientRef: React.MutableRefObject<LoadstarClient | undefined>;
}

export function Chat({ onTraceId, clientRef }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [toolName, setToolName] = useState<string>();
  const [conversationId, setConversationId] = useState<string>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastSeqRef = useRef(0);

  useEffect(() => {
    clientRef.current = new LoadstarClient({ baseUrl: API_URL });
  }, [clientRef]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, status]);

  const handleEvent = useCallback(
    (event: AgentEvent) => {
      const data = event.data as Record<string, unknown>;
      if (data.traceId && onTraceId) {
        onTraceId(data.traceId as string);
      }

      switch (event.type) {
        case "turn.start":
          setStatus("thinking");
          break;
        case "tool.start":
          setStatus("tool");
          setToolName((data as { name?: string }).name);
          break;
        case "tool.result":
          setStatus("thinking");
          break;
        case "turn.complete":
          setStatus("idle");
          if (conversationId) {
            clientRef.current
              ?.getMessages(conversationId, lastSeqRef.current)
              .then((msgs) => {
                if (msgs.length > 0) {
                  lastSeqRef.current = msgs[msgs.length - 1].seq;
                  setMessages((prev) => [...prev, ...msgs]);
                }
              });
          }
          break;
        case "error":
          setStatus("error");
          break;
      }
    },
    [conversationId, onTraceId, clientRef]
  );

  async function handleSend(content: string) {
    const client = clientRef.current;
    if (!client) return;

    let convId = conversationId;
    if (!convId) {
      const conv = await client.createConversation(AGENT_NAME);
      convId = conv.id;
      setConversationId(convId);
    }

    const optimistic: Message = {
      id: crypto.randomUUID(),
      conversationId: convId,
      role: "user",
      content,
      seq: lastSeqRef.current + 1,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setStatus("thinking");

    const result = await client.sendMessage(convId, content);

    client.connectRelay(convId, result.relayId);
    client.on("*", handleEvent);
  }

  return (
    <div className="flex flex-col h-full">
      <CardContent className="flex-1 p-0 overflow-hidden">
        <ScrollArea ref={scrollRef} className="h-full">
          <div className="py-4">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[60vh] text-muted-foreground">
                <Compass className="h-12 w-12 mb-4 opacity-20" />
                <p className="text-sm">Send a message to begin</p>
              </div>
            ) : (
              messages.map((msg) => (
                <ChatMessage key={msg.id} message={msg} />
              ))
            )}
            <StatusIndicator status={status} toolName={toolName} />
          </div>
        </ScrollArea>
      </CardContent>
      <ChatInput
        onSend={handleSend}
        disabled={status === "thinking" || status === "tool"}
      />
    </div>
  );
}
