"use client";

import { forwardRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { CategoryBarChart, CategoryDonutChart, PALETTE, TimeSeriesChart, type CountRow } from "@/components/charts";
import { CATEGORY_COLORS } from "@/lib/github/categorize";
import type { KpiCard } from "./kpi-row";
import type { Metrics } from "@/lib/api/github";

/**
 * A linear, paginating version of the dashboard, captured by Export PDF.
 *
 * This exists rather than capturing the live dashboard because the live version
 * is a scrolling grid: exporting it clipped the report to whatever happened to
 * be visible in the tile. A separate document also lets the export be laid out
 * for paper, at a fixed width, with page breaks in sensible places.
 *
 * Two positioning details that both come from real failures:
 *
 * 1. The container is positioned ABSOLUTE and moved off screen, not `fixed`.
 *    Canvas capture cannot see fixed elements, so a fixed container exports a
 *    blank page. Kendo's exporter had the identical limitation.
 *
 * 2. It is moved off screen rather than hidden with display:none or
 *    visibility:hidden. A hidden element has no layout, so the charts inside it
 *    render at zero height and export as empty boxes.
 */
export const PrintDocument = forwardRef<
  HTMLDivElement,
  {
    title: string;
    metaLines: string[];
    kpiCards: KpiCard[];
    metrics?: Metrics;
    byRepo: CountRow[];
    byProject: CountRow[];
    linesByProject: CountRow[];
    byAuthor: CountRow[];
    linesByAuthor: CountRow[];
    reportMd?: string;
  }
>(function PrintDocument(props, ref) {
  const { title, metaLines, kpiCards, metrics, reportMd } = props;

  const charts: Array<{ title: string; node: React.ReactNode }> = [
    {
      title: "Commits Over Time",
      node: <TimeSeriesChart data={metrics?.commitsOverTime} type="line" name="Commits" color="#0d6efd" />,
    },
    {
      title: "Commits by Category",
      node: (
        <CategoryDonutChart
          data={metrics?.byCategory}
          colorByCategory={(c, i) => CATEGORY_COLORS[c] ?? PALETTE[i % PALETTE.length]}
        />
      ),
    },
    { title: "Commits by Repository", node: <CategoryBarChart data={props.byRepo} color="#6f42c1" horizontal /> },
    { title: "Commits by Author", node: <CategoryDonutChart data={props.byAuthor} /> },
    { title: "Commits by Project", node: <CategoryBarChart data={props.byProject} color="#20c997" horizontal /> },
    {
      title: "Lines Added by Project",
      node: <CategoryBarChart data={props.linesByProject} color="#198754" horizontal />,
    },
    { title: "Lines Added by Author", node: <CategoryDonutChart data={props.linesByAuthor} /> },
    {
      title: "Lines Added Over Time",
      node: <TimeSeriesChart data={metrics?.linesOverTime} type="column" name="lines added" color="#198754" />,
    },
  ];

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-[-10000px] top-0"
      style={{ width: 1100 }}
    >
      <div ref={ref} className="bg-background p-8 text-foreground" style={{ width: 1100 }}>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <div className="mt-2 text-xs text-muted-foreground">
          {metaLines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>

        <div className="mt-6 grid grid-cols-4 gap-3">
          {kpiCards.map((card) => (
            <div
              key={card.label}
              className="rounded-lg border border-border border-t-2 p-3"
              style={{ borderTopColor: card.accent }}
            >
              <div className="text-xl font-semibold tabular-nums">{card.value}</div>
              <div className="text-xs text-muted-foreground">{card.label}</div>
            </div>
          ))}
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4">
          {charts.map((chart) => (
            <div key={chart.title} className="rounded-lg border border-border p-3">
              <h2 className="mb-2 text-sm font-medium">{chart.title}</h2>
              <div style={{ height: 260 }}>{chart.node}</div>
            </div>
          ))}
        </div>

        {reportMd && (
          <div className="mt-8">
            <h2 className="mb-3 text-lg font-semibold">Work Report</h2>
            <div className="report-prose text-xs">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                {reportMd}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
