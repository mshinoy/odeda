import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PagerProps {
  /** "1–50 of 488", already formatted. */
  label: string;
  page: number;
  pages: number;
  onPage: (page: number) => void;
}

export function Pager({ label, page, pages, onPage }: PagerProps) {
  return (
    <div className="text-muted-foreground flex items-center gap-3 text-sm">
      <span>{label}</span>
      {pages > 1 && (
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Next page"
            disabled={page >= pages}
            onClick={() => onPage(page + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      )}
    </div>
  );
}
