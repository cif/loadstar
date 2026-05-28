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
  conversationId?: string;
  onConversationCreated?: (id: string) => void;
}

export function Chat({
  onTraceId,
  clientRef,
  conversationId: initialConvId,
  onConversationCreated,
}: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [toolName, setToolName] = useState<string>();
  const [conversationId, setConversationId] = useState<string | undefined>(
    initialConvId
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastSeqRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  // Load existing conversation messages
  useEffect(() => {
    if (initialConvId && clientRef.current) {
      setConversationId(initialConvId);
      lastSeqRef.current = 0;
      clientRef.current.getMessages(initialConvId).then((msgs) => {
        setMessages(msgs);
        if (msgs.length > 0) {
          lastSeqRef.current = msgs[msgs.length - 1].seq;
        }
      });
    }
  }, [initialConvId, clientRef]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, status]);

  const fetchNewMessages = useCallback(
    async (convId: string) => {
      const client = clientRef.current;
      if (!client) return false;
      const msgs = await client.getMessages(convId, lastSeqRef.current);
      if (msgs.length > 0) {
        lastSeqRef.current = msgs[msgs.length - 1].seq;
        setMessages((prev) => {
          const withoutOptimistic = prev.filter(
            (m) => !m.id.startsWith("optimistic-")
          );
          const existingIds = new Set(withoutOptimistic.map((m) => m.id));
          const newMsgs = msgs.filter((m) => !existingIds.has(m.id));
          return [...withoutOptimistic, ...newMsgs];
        });
        const hasAssistantResponse = msgs.some(
          (m) => m.role === "assistant" && m.content && !m.toolCalls?.length
        );
        return hasAssistantResponse;
      }
      return false;
    },
    [clientRef]
  );

  useEffect(() => {
    if ((status === "thinking" || status === "tool") && conversationId) {
      pollRef.current = setInterval(async () => {
        const done = await fetchNewMessages(conversationId);
        if (done) {
          setStatus("idle");
          if (pollRef.current) clearInterval(pollRef.current);
        }
      }, 2000);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }
  }, [status, conversationId, fetchNewMessages]);

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
          if (conversationId) {
            fetchNewMessages(conversationId).then(() => {
              setStatus("idle");
              if (pollRef.current) clearInterval(pollRef.current);
            });
          }
          break;
        case "error":
          break;
      }
    },
    [conversationId, onTraceId, fetchNewMessages]
  );

  async function handleSend(content: string) {
    const client = clientRef.current;
    if (!client) return;

    let convId = conversationId;
    if (!convId) {
      const conv = await client.createConversation(AGENT_NAME);
      convId = conv.id;
      setConversationId(convId);
      onConversationCreated?.(convId);
    }

    setMessages((prev) => [
      ...prev,
      {
        id: `optimistic-${Date.now()}`,
        conversationId: convId,
        role: "user" as const,
        content,
        seq: -1,
        createdAt: new Date().toISOString(),
      },
    ]);
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
