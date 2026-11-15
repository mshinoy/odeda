import { useRef, useState } from "react";
import {
  usePreviewPlanUpload,
  useUploadPlan,
  type Plan,
  type PlanUploadSummary,
} from "@/api/queries/usePlan";
import { SectionCard } from "@/components/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { nextMonday, previewLines } from "@/features/plan/uploadView";
import { formatAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ChangePlanCardProps {
  plan: Plan;
  /** Opens the current week's detail, where a session can be moved or changed. */
  onEditWeek: () => void;
}

/**
 * Change the plan: edit a week, or replace the plan with an uploaded file.
 *
 * Uploading is two steps on purpose. The first shows what would change, including the
 * one thing that would surprise (the race leaving the plan), and writes nothing; the
 * second, after the owner has read it, does it. The file is read in the browser and sent
 * as text, so there is no upload to store or clean up.
 */
export function ChangePlanCard({ plan, onEditWeek }: ChangePlanCardProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [content, setContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [day, setDay] = useState(() => nextMonday(plan.today));
  const [label, setLabel] = useState("");
  const [preview, setPreview] = useState<PlanUploadSummary | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const previewing = usePreviewPlanUpload();
  const uploading = useUploadPlan();

  const source = plan.source;
  const live = source
    ? source.kind === "upload"
      ? `${source.label ?? "Uploaded plan"}, uploaded ${source.last_fetch_at ? formatAgo(source.last_fetch_at) : ""}`.trim()
      : `${source.label ?? "Calendar"}, read ${source.last_fetch_at ? formatAgo(source.last_fetch_at) : "never"}`
    : "none";

  const reset = () => {
    setContent(null);
    setFileName(null);
    setPreview(null);
    setProblem(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setPreview(null);
    setProblem(null);
    setFileName(file.name);
    setContent(await file.text());
  };

  const runPreview = () => {
    if (content === null) return;
    setProblem(null);
    previewing.mutate(
      { content, effectiveDay: day },
      {
        onSuccess: setPreview,
        onError: (e) => {
          setPreview(null);
          setProblem(e.message);
        },
      },
    );
  };

  const confirm = () => {
    if (content === null) return;
    uploading.mutate(
      { content, effectiveDay: day, label: label.trim() || fileName },
      { onSuccess: reset, onError: (e) => setProblem(e.message) },
    );
  };

  return (
    <SectionCard
      title="Change the plan"
      question="Adjust a week, or replace the plan with a new one."
    >
      <div className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground text-xs">The plan in use</span>
        <span className="font-medium">{live}</span>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Adjust a week</span>
        <p className="text-muted-foreground text-sm">
          Move a session to another day, change its distance, or add one of your own. The calendar
          is not touched, and a sync never undoes it.
        </p>
        <Button size="sm" variant="outline" className="self-start" onClick={onEditWeek}>
          Adjust this week
        </Button>
      </div>

      <div className="flex flex-col gap-3 border-t pt-5">
        <span className="text-sm font-medium">Upload a new plan</span>
        <p className="text-muted-foreground text-sm">
          A calendar file (.ics), or a table (.csv) with <code>date</code>, <code>title</code> and
          optionally <code>distance_km</code> columns. Earlier weeks keep the plan they were judged
          against.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <input
            ref={fileInput}
            type="file"
            accept=".ics,.csv,text/calendar,text/csv"
            onChange={(e) => void choose(e.target.files?.[0])}
            className="file:bg-secondary file:text-secondary-foreground text-sm file:mr-3 file:rounded-lg file:border-0 file:px-3 file:py-1.5 file:text-xs"
            aria-label="Plan file"
          />
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Takes over from</span>
            <Input
              type="date"
              value={day}
              onChange={(e) => {
                setDay(e.target.value);
                setPreview(null);
              }}
              className="w-auto"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Name (optional)</span>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} className="w-44" />
          </label>
          <Button
            size="sm"
            disabled={content === null || previewing.isPending}
            onClick={runPreview}
          >
            {previewing.isPending ? "Reading…" : "Preview"}
          </Button>
        </div>

        {problem && <p className="text-destructive text-sm">{problem}</p>}

        {preview && (
          <div className="bg-muted/60 flex flex-col gap-3 rounded-xl p-4">
            <ul className="flex flex-col gap-1.5 text-sm">
              {previewLines(preview).map((line) => (
                <li key={line.text} className={cn(line.warning && "text-delta-bad font-medium")}>
                  {line.text}
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Button size="sm" disabled={uploading.isPending} onClick={confirm}>
                {uploading.isPending ? "Replacing…" : "Replace the plan"}
              </Button>
              <Button size="sm" variant="ghost" onClick={reset}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
