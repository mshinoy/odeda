import type { ReactNode } from "react";

interface EmptyStateProps {
  message: string;
  action?: ReactNode;
}

/** One short line and, optionally, one thing to do about it. */
export function EmptyState({ message, action }: EmptyStateProps) {
  return (
    <div className="text-muted-foreground flex flex-col items-center justify-center gap-3 py-24 text-sm">
      <p>{message}</p>
      {action}
    </div>
  );
}
