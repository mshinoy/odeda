import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface InfoPopoverProps {
  /** What the popup is called, at its top. */
  title: string;
  /** "link": the trigger is words. "icon": a small (i) that sits beside a heading. */
  trigger?: { kind: "link"; label: string } | { kind: "icon" };
  children: ReactNode;
  className?: string;
}

/**
 * An explanation that opens over the page instead of pushing it down. Anything that
 * explains how a number was worked out, or how to read a chart, goes here: the answer
 * stays on the page, the working is one click away, and nothing around it moves.
 */
export function InfoPopover({
  title,
  trigger = { kind: "icon" },
  children,
  className,
}: InfoPopoverProps) {
  return (
    <Popover>
      {trigger.kind === "link" ? (
        <PopoverTrigger
          className={cn(
            "text-muted-foreground hover:text-foreground self-start text-left text-xs underline-offset-4 hover:underline",
            className,
          )}
        >
          {trigger.label}
        </PopoverTrigger>
      ) : (
        <PopoverTrigger
          aria-label={`About: ${title}`}
          className={cn(
            "text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex size-6 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none",
            className,
          )}
        >
          <Info className="size-4" aria-hidden />
        </PopoverTrigger>
      )}
      <PopoverContent>
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">{title}</h3>
          <div className="text-ink-secondary flex flex-col gap-2 text-sm leading-relaxed">
            {children}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
