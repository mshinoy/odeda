import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * A native select, styled like shadcn's Input. For short, flat lists: the browser's own
 * picker is the most usable one on every device and follows the theme (`color-scheme`).
 */
export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "border-input dark:bg-input/30 h-8 rounded-lg border bg-transparent px-2 text-sm",
        "focus-visible:border-ring focus-visible:ring-ring/50 outline-none focus-visible:ring-3",
        className,
      )}
      {...props}
    />
  );
}
