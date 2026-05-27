import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface StatusIndicatorProps {
  status: "idle" | "thinking" | "tool" | "error";
  toolName?: string;
}

export function StatusIndicator({ status, toolName }: StatusIndicatorProps) {
  if (status === "idle") return null;

  return (
    <div className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground">
      {status === "error" ? (
        <span className="text-destructive">Connection lost. Messages will appear when reconnected.</span>
      ) : (
        <>
          <Loader2
            className={cn(
              "h-3.5 w-3.5 animate-spin",
              status === "tool" && "text-chart-2"
            )}
          />
          <span>
            {status === "thinking" && "Thinking..."}
            {status === "tool" && `Running ${toolName ?? "tool"}...`}
          </span>
        </>
      )}
    </div>
  );
}
