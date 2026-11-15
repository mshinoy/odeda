import { SectionCard } from "@/components/SectionCard";
import { useConfig } from "@/api/queries/useSettings";
import { useSummary } from "@/api/queries/useStatus";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";

/** What is running, and what it holds. */
export function AboutPanel() {
  const config = useConfig();
  const summary = useSummary();

  if (config.isPending || summary.isPending) {
    return <Skeleton className="h-20 w-full" />;
  }

  const range = summary.data?.day_range;
  const facts = [
    { label: "Version", value: config.data?.version ?? "—" },
    {
      label: "Data",
      value: range ? `${formatDate(range.from)} → ${formatDate(range.to)}` : "—",
    },
    // Null until a race is in the calendar (T57).
    { label: "Race", value: config.data?.race?.name ?? "—" },
    { label: "Race day", value: formatDate(config.data?.race?.date) },
  ];

  return (
    <SectionCard title="About" question="This install.">
      <dl className="flex w-full flex-col gap-1 text-sm">
        {facts.map((fact) => (
          <div key={fact.label} className="flex justify-between border-b py-1.5">
            <dt className="text-muted-foreground">{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
    </SectionCard>
  );
}
