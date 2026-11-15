import type { ReactNode } from "react";

interface SectionCardProps {
  title: string;
  /** One line on what the card answers. */
  question: string;
  children: ReactNode;
}

/** A Health section as a card: what it answers, its numbers, then the charts behind them. */
export function SectionCard({ title, question, children }: SectionCardProps) {
  return (
    <section className="bg-card shadow-card flex flex-col gap-6 rounded-2xl border p-7">
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="text-muted-foreground text-sm">{question}</p>
      </header>
      {children}
    </section>
  );
}
