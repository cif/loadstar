import { useEffect, useState } from "react";
import { LoadstarClient } from "@loadstar/client";
import type { Conversation } from "@loadstar/client";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { MessageSquare, Plus } from "lucide-react";

interface ConversationListProps {
  client: LoadstarClient | null;
  activeId?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
}

export function ConversationList({
  client,
  activeId,
  onSelect,
  onNew,
}: ConversationListProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);

  useEffect(() => {
    if (!client) return;
    client
      .listAgents()
      .then(() =>
        fetch(
          `${(client as unknown as { baseUrl: string }).baseUrl}/conversations`
        )
      )
      .catch(() => {});

    const url = (client as unknown as { baseUrl: string }).baseUrl;
    fetch(`${url}/conversations`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setConversations(data);
      })
      .catch(() => {});
  }, [client]);

  // Refresh when activeId changes (new conversation created)
  useEffect(() => {
    if (!client || !activeId) return;
    const url = (client as unknown as { baseUrl: string }).baseUrl;
    fetch(`${url}/conversations`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setConversations(data);
      })
      .catch(() => {});
  }, [client, activeId]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
        <span className="text-sm font-medium">Chats</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onNew}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        {conversations.length === 0 ? (
          <div className="px-3 py-6 text-xs text-muted-foreground text-center">
            No conversations yet
          </div>
        ) : (
          <div className="flex flex-col">
            {conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/50 transition-colors border-b",
                  activeId === conv.id && "bg-muted"
                )}
              >
                <MessageSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate font-mono">
                    {conv.id.slice(0, 8)}
                  </div>
                  <div className="text-muted-foreground">
                    {new Date(conv.createdAt).toLocaleTimeString()}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
