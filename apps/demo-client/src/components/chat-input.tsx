import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SendHorizontal } from "lucide-react";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 p-4 border-t">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Send a message..."
        disabled={disabled}
        className="flex-1"
        autoFocus
      />
      <Button type="submit" size="icon" disabled={disabled || !value.trim()}>
        <SendHorizontal className="h-4 w-4" />
      </Button>
    </form>
  );
}
