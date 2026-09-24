import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface DetailSectionProps {
  title: string;
  children: ReactNode;
}

/**
 * A detail block under the charts, closed until asked for. The content mounts on open,
 * so a chart inside is sized to its real width.
 */
export function DetailSection({ title, children }: DetailSectionProps) {
  return (
    <Collapsible className="border-t">
      <CollapsibleTrigger className="group text-muted-foreground hover:text-foreground focus-visible:ring-ring flex w-full items-center justify-between rounded-sm py-3 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none">
        <span>{title}</span>
        <ChevronDown
          aria-hidden
          className="size-4 transition-transform duration-150 group-data-[state=open]:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="pb-6">{children}</CollapsibleContent>
    </Collapsible>
  );
}
