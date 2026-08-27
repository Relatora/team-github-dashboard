"use client";

import type { Metrics } from "@/lib/api/github";

/**
 * The headline numbers.
 *
 * Lines Removed is hidden by default and Issues Created is shown by default,
 * both carried over from the source. Removed reliably confuses non-technical
 * readers, who see a large negative number and read it as damage rather than as
 * refactoring; a developer can reveal it from the settings panel.
 */

export type KpiCard = { label: string; value: string; accent: string };

export function buildKpiCards(
  kpis: Metrics["kpis"] | undefined,
  options: { showRemoved: boolean; showIssues: boolean }
): KpiCard[] {
  const k = kpis;
  const fmt = (n: number | undefined) => (n ?? 0).toLocaleString();

  return [
    { label: "Commits", value: fmt(k?.commits), accent: "#0d6efd" },
    { label: "Projects", value: fmt(k?.repos), accent: "#6f42c1" },
    { label: "Lines Added", value: `+${fmt(k?.additions)}`, accent: "#198754" },
    ...(options.showRemoved
      ? [{ label: "Lines Removed", value: `-${fmt(k?.deletions)}`, accent: "#dc3545" }]
      : []),
    { label: "File Changes", value: fmt(k?.files), accent: "#fd7e14" },
    ...(options.showIssues
      ? [{ label: "Issues Created", value: fmt(k?.issues), accent: "#0dcaf0" }]
      : []),
    { label: "Contributors", value: fmt(k?.contributors), accent: "#20c997" },
  ];
}

export function KpiRow({ cards }: { cards: KpiCard[] }) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-lg border border-border border-t-2 bg-card p-3"
          style={{ borderTopColor: card.accent }}
        >
          <div className="text-xl font-semibold tabular-nums">{card.value}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{card.label}</div>
        </div>
      ))}
    </div>
  );
}
