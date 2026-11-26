import { Download } from "lucide-react";
import { SectionCard } from "@/components/SectionCard";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** One file with everything that cannot be fetched again. A plain link: the browser saves it. */
export function BackupPanel() {
  return (
    <SectionCard title="Backup" question="Is my data safe?">
      <div className="flex w-full flex-col gap-3 text-sm">
        <p className="text-muted-foreground">
          One zip with your database, which holds every Garmin response and every edit you have
          made, and your course files. Your Garmin and Google sign-ins are left out on purpose, so
          the file is safe to keep in a cloud folder; sign in again after restoring.
        </p>
        <a
          href="/api/backup"
          download
          className={cn(buttonVariants({ variant: "outline" }), "w-fit gap-2")}
        >
          <Download className="size-4" />
          Download backup
        </a>
        <p className="text-muted-foreground text-xs">
          It can take a few seconds and a few hundred MB. To restore, see Configuration in the docs.
        </p>
      </div>
    </SectionCard>
  );
}
