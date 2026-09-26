import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { useFitbitImport } from "@/api/queries/useFitbit";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { importSummary } from "@/features/settings/fitbitSummary";

/**
 * The offline route: a Fitbit export from Google Takeout, read off the server's disk.
 *
 * Collapsed, because it is the second-choice path — but kept beside the connection
 * rather than hidden elsewhere, because it is the one that still works if Google
 * retires the Web API, and the one that loads a decade of history without spending a
 * single one of the 150 requests an hour.
 *
 * A path rather than a file upload: the archive is hundreds of megabytes, this app is
 * single-tenant and runs on the owner's own machine, and streaming a multipart upload
 * through it to write it straight back to disk would be work for no gain.
 */
export function FitbitImportForm() {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState("");
  const load = useFitbitImport();

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="max-w-lg border-t">
      <CollapsibleTrigger className="group text-muted-foreground hover:text-foreground focus-visible:ring-ring flex w-full items-center justify-between rounded-sm py-3 text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none">
        <span>Import a Fitbit export instead</span>
        <ChevronDown
          aria-hidden
          className="size-4 transition-transform duration-150 group-data-[state=open]:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-3 pb-6">
        <p className="text-muted-foreground text-sm">
          Take your Fitbit data out through Google Takeout, put the ZIP somewhere this app can read,
          and give the path. No account connection, no rate limit.
        </p>

        <Input
          aria-label="Path to the export ZIP"
          placeholder="/data/takeout-fitbit.zip"
          value={path}
          onChange={(event) => setPath(event.target.value)}
        />

        <div>
          <Button
            type="button"
            size="sm"
            disabled={load.isPending || path.trim() === ""}
            onClick={() => load.mutate(path.trim())}
          >
            {load.isPending ? "Reading…" : "Import"}
          </Button>
        </div>

        {load.data && (
          <p className="text-muted-foreground text-sm" role="status">
            {importSummary(load.data)}
          </p>
        )}
        {load.error && <p className="text-delta-bad text-sm">{load.error.message}</p>}
      </CollapsibleContent>
    </Collapsible>
  );
}
