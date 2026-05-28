import { useCallback, useEffect, useRef, useState } from "react";
import type { LoadstarClient, AgentEvent, Message } from "@loadstar/client";
import { CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatMessage } from "./chat-message";
import { ChatInput } from "./chat-input";
import { StatusIndicator } from "./status-indicator";
import { Compass } from "lucide-react";

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const convIdRef = useRef<string | undefined>(initialConvId);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  // Load existing conversation messages
  useEffect(() => {
    if (initialConvId && clientRef.current) {
      convIdRef.current = initialConvId;
      clientRef.current.getMessages(initialConvId).then((msgs) => {
        setMessages(msgs);
      });
    }
  }, [initialConvId, clientRef]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, status]);

  const fetchAllMessages = useCallback(async (): Promise<boolean> => {
    const client = clientRef.current;
    const convId = convIdRef.current;
    if (!client || !convId) return false;
    try {
      const msgs = await client.getMessages(convId);
      if (msgs.length > 0) {
        setMessages(msgs);
        const lastMsg = msgs[msgs.length - 1];
        const isDone =
          (lastMsg.role === "assistant" && !lastMsg.toolCalls?.length) ||
          lastMsg.content === "Max turns reached.";
        return isDone;
      }
    } catch {
      // ignore fetch errors during polling
    }
    return false;
  }, [clientRef]);

  // Poll while thinking/tool
  useEffect(() => {
    if (status === "thinking" || status === "tool") {
      pollRef.current = setInterval(async () => {
        const done = await fetchAllMessages();
        if (done) {
          setStatus("idle");
          if (pollRef.current) clearInterval(pollRef.current);
        }
      }, 2000);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }
  }, [status, fetchAllMessages]);

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
          fetchAllMessages().then(() => {
            setStatus("idle");
            if (pollRef.current) clearInterval(pollRef.current);
          });
          break;
      }
    },
    [onTraceId, fetchAllMessages]
  );

  async function handleSend(content: string) {
    const client = clientRef.current;
    if (!client) return;

    let convId = convIdRef.current;
    if (!convId) {
      const conv = await client.createConversation(AGENT_NAME);
      convId = conv.id;
      convIdRef.current = convId;
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
            {messages.length === 0 && status === "idle" ? (
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
