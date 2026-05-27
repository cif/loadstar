import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Bot, User, Wrench } from "lucide-react";
import type { Message } from "@loadstar/client";

interface ChatMessageProps {
  message: Message;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const isTool = message.role === "tool";

  if (isTool && message.toolResults) {
    return (
      <div className="flex gap-3 px-4 py-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
          <Wrench className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-1.5 min-w-0">
          {message.toolResults.map((result) => (
            <div
              key={result.toolCallId}
              className="rounded-lg border bg-muted/50 px-3 py-2"
            >
              <div className="flex items-center gap-2 mb-1">
                <Badge
                  variant={result.isError ? "destructive" : "secondary"}
                  className="text-xs"
                >
                  {result.name}
                </Badge>
                {result.isError && (
                  <span className="text-xs text-destructive">error</span>
                )}
              </div>
              <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-all font-mono">
                {formatToolResult(result.result)}
              </pre>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn("flex gap-3 px-4 py-3", isUser && "flex-row-reverse")}
    >
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-primary" : "bg-muted"
        )}
      >
        {isUser ? (
          <User className="h-4 w-4 text-primary-foreground" />
        ) : (
          <Bot className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      <div
        className={cn(
          "rounded-2xl px-4 py-2.5 max-w-[80%]",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground"
        )}
      >
        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {message.toolCalls.map((tc) => (
              <Badge key={tc.id} variant="outline" className="text-xs">
                {tc.name}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatToolResult(result: string): string {
  try {
    return JSON.stringify(JSON.parse(result), null, 2);
  } catch {
    return result;
  }
}
