import type { ReactNode } from "react";

interface SectionCardProps {
  title: string;
  /** One line on what the card answers. */
  question: string;
  /** A note beside the title, such as what a filter does not reach. */
  note?: string;
  children: ReactNode;
}

/** A page section as a card: what it answers, its numbers, then the charts behind them. */
export function SectionCard({ title, question, note, children }: SectionCardProps) {
  return (
    <section className="bg-card shadow-card flex flex-col gap-6 rounded-2xl border p-7">
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="text-muted-foreground text-sm">
          {question}
          {note && <span className="ml-2 text-xs">· {note}</span>}
        </p>
      </header>
      {children}
    </section>
  );
}
