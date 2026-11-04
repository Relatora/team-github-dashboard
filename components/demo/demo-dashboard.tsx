"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { ControlCenter } from "@/components/github/control-center";
import { KpiRow, buildKpiCards } from "@/components/github/kpi-row";
import { ReportView } from "@/components/github/report-view";
import { LocalTime } from "@/components/ui/local-time";
import { Button } from "@/components/ui/button";
import { CategoryBarChart, CategoryDonutChart, PALETTE, TimeSeriesChart } from "@/components/charts";

import { getDemoMetrics, getDemoReport, getDemoRuns, getDemoUsers } from "@/lib/api/demo";
import { CATEGORY_COLORS } from "@/lib/github/categorize";
import { DEFAULT_FILTERS, applyFilterChange, filtersToDateRange, ymd, type Filters } from "@/lib/dashboard/filters";
import { consolidateByProject, nameFrom } from "@/lib/dashboard/projects";

/**
 * The public demo dashboard.
 *
 * A dedicated component, not the real Dashboard with a readOnly prop toggled
 * on: it only imports lib/api/demo's read calls, so it is structurally
 * incapable of starting a scan, adding a tracked user, or opening the GitHub
 * token dialog - those functions are never imported here, not hidden behind
 * a flag someone could later forget to check. isDeveloper is always false
 * going into ControlCenter for the same reason: the one mutating control it
 * renders (Refresh data) simply does not exist in this tree.
 *
 * No layout drag-and-drop: the demo's job is to show the data and the
 * cleaned-vs-raw contrast, not to prove tile rearranging works, so this skips
 * react-grid-layout and lib/dashboard/layout's localStorage persistence
 * entirely - both irrelevant here and, for the layout storage, a needless way
 * to share state with the real /github page on the same origin.
 */

const NO_USERS = "__none__";
const TOP_N = 15;

/**
 * The last 12 months, not the real dashboard's "this month" default. The seed
 * covers exactly the trailing 12 months, and opening on the current month
 * meant a visitor on the 4th saw four days of data and a single dot on the
 * time series - the worst possible first impression for a demo.
 */
function trailingYear(): Filters {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - 1);
  start.setDate(start.getDate() + 1);
  return { ...DEFAULT_FILTERS, period: "custom", startDate: ymd(start), endDate: ymd(end) };
}

export function DemoDashboard() {
  const [filters, setFilters] = useState<Filters>(trailingYear);
  const [calcMode, setCalcMode] = useState<"cleaned" | "raw">("cleaned");
  const [showRemoved, setShowRemoved] = useState(false);
  const [showIssues, setShowIssues] = useState(true);

  const { data: roster = [], isSuccess: rosterLoaded } = useQuery({
    queryKey: ["demoRoster"],
    queryFn: getDemoUsers,
  });

  const { data: runs } = useQuery({ queryKey: ["demoRuns"], queryFn: () => getDemoRuns(1) });
  const lastRun = runs?.[0];

  const selectedUsers = useMemo(() => {
    const pool = roster.map((u) => u.handle.toLowerCase());
    const base = filters.users ?? roster.map((u) => u.handle);
    return base.filter((h) => pool.includes(h.toLowerCase()));
  }, [filters.users, roster]);

  const usersParam = selectedUsers.length ? selectedUsers.join(",") : NO_USERS;
  const isCustom = filters.period === "custom";

  const metricsParams = useMemo(
    () => ({
      year: isCustom ? "" : String(filters.year ?? ""),
      month: filters.period === "month" ? String(filters.month ?? "") : "",
      quarter: filters.period === "quarter" ? String(filters.quarter ?? "") : "",
      start: isCustom ? filters.startDate : "",
      end: isCustom ? filters.endDate : "",
      users: usersParam,
      calc: calcMode,
    }),
    [isCustom, filters, usersParam, calcMode]
  );

  const { data: metrics, isFetching } = useQuery({
    queryKey: ["demoMetrics", metricsParams],
    queryFn: () => getDemoMetrics(metricsParams),
    placeholderData: (previous) => previous,
  });

  const reportBody = useMemo(
    () => ({
      users: selectedUsers.length ? selectedUsers : [NO_USERS],
      audience: "leadership" as const,
      calc: calcMode,
      show_removed: showRemoved,
      ...filtersToDateRange(filters),
    }),
    [selectedUsers, filters, calcMode, showRemoved]
  );

  const {
    data: reportMd,
    isFetching: reportFetching,
    error: reportError,
  } = useQuery({
    queryKey: ["demoReport", reportBody],
    queryFn: () => getDemoReport(reportBody),
    enabled: rosterLoaded,
    placeholderData: (previous) => previous,
    retry: false,
  });

  const shortRepo = (row: { _id: string; count: number }) => ({
    _id: String(row._id).split("/").pop() ?? row._id,
    count: row.count,
  });

  const byRepo = (metrics?.byRepo ?? []).slice(0, TOP_N).map(shortRepo);
  const byProject = consolidateByProject(metrics?.byRepo ?? []).slice(0, TOP_N);
  const linesByProject = consolidateByProject(metrics?.linesByRepo ?? []).slice(0, TOP_N);
  const byAuthor = (metrics?.byAuthor ?? []).map((d) => ({ ...d, _id: nameFrom(roster, d._id) }));
  const linesByAuthor = (metrics?.linesByAuthor ?? []).map((d) => ({ ...d, _id: nameFrom(roster, d._id) }));

  const kpiCards = buildKpiCards(metrics?.kpis, { showRemoved, showIssues });

  return (
    <div className="mx-auto max-w-[1800px]">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">GitHub Work Dashboard - Live Demo</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Synthetic data for four fictional people across six example repositories, generated by
            <code className="mx-1 rounded bg-muted px-1 py-0.5">scripts/seed-demo.ts</code>
            - nothing here is scanned from a real organization.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          {lastRun ? <>Demo data generated <LocalTime value={lastRun.generatedAt} /></> : "Loading demo data"}
        </p>
      </div>

      <div className="mb-4 rounded-lg border border-sky-500/30 bg-sky-500/5 p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">The whole pitch, in one toggle:</span>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={calcMode === "cleaned" ? "default" : "outline"}
              onClick={() => setCalcMode("cleaned")}
              title="Exclude generated and vendored files, and count merge commits as zero"
            >
              Cleaned
            </Button>
            <Button
              size="sm"
              variant={calcMode === "raw" ? "default" : "outline"}
              onClick={() => setCalcMode("raw")}
              title="Raw GitHub diff totals, including generated files and merges"
            >
              Raw
            </Button>
          </div>
          <span className="text-muted-foreground">
            Raw line counts are inflated by generated files and merge commits. Cleaned is what is
            left after both are removed - this is the whole reason the tool exists.
          </span>
        </div>

        {/* The rest of the real dashboard's Developer settings, minus the
            parts a demo has nothing behind: no token, no scan, no schedule,
            no roster to manage. Lines removed and the Issues tile are pure
            display preferences, so they cost nothing to expose here too. */}
        <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-sky-500/20 pt-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Lines removed</span>
            <Button size="sm" variant={showRemoved ? "default" : "outline"} onClick={() => setShowRemoved((v) => !v)}>
              {showRemoved ? "Shown" : "Hidden"}
            </Button>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Issues tile</span>
            <Button size="sm" variant={showIssues ? "default" : "outline"} onClick={() => setShowIssues((v) => !v)}>
              {showIssues ? "Shown" : "Hidden"}
            </Button>
          </div>
        </div>
      </div>

      <ControlCenter
        filters={{ ...filters, users: selectedUsers }}
        onChange={(patch) => setFilters((previous) => applyFilterChange(previous, patch))}
        roster={roster}
        isFetching={isFetching}
        isScanning={false}
        isExporting={false}
        isDeveloper={false}
        showCustomRange
        onRefresh={() => {}}
        onExportPdf={() => {}}
        onExportMarkdown={() => {}}
        onResetLayout={() => {}}
      />

      <KpiRow cards={kpiCards} />

      <div className="grid gap-3 md:grid-cols-2">
        <Tile header="Commits Over Time">
          <TimeSeriesChart data={metrics?.commitsOverTime} type="line" name="Commits" color="#0d6efd" />
        </Tile>
        <Tile header="Commits by Category">
          <CategoryDonutChart
            data={metrics?.byCategory}
            colorByCategory={(c, i) => CATEGORY_COLORS[c] ?? PALETTE[i % PALETTE.length]}
          />
        </Tile>
        <Tile header={`Commits by Repository (top ${TOP_N})`}>
          <CategoryBarChart data={byRepo} color="#6f42c1" horizontal />
        </Tile>
        <Tile header="Commits by Author">
          <CategoryDonutChart data={byAuthor} />
        </Tile>
        <Tile header={`Commits by Project (top ${TOP_N})`}>
          <CategoryBarChart data={byProject} color="#20c997" horizontal />
        </Tile>
        <Tile header={`Lines Added by Project (top ${TOP_N})`}>
          <CategoryBarChart data={linesByProject} color="#198754" horizontal />
        </Tile>
        <Tile header="Lines Added by Author">
          <CategoryDonutChart data={linesByAuthor} />
        </Tile>
        <Tile header="Lines Added Over Time">
          <TimeSeriesChart data={metrics?.linesOverTime} type="column" name="lines added" color="#198754" />
        </Tile>
        <Tile header="Work Report" className="md:col-span-2" tall>
          <ReportView markdown={reportMd} isLoading={reportFetching} error={reportError} />
        </Tile>
      </div>
    </div>
  );
}

function Tile({
  header,
  children,
  className,
  tall = false,
}: {
  header: string;
  children: React.ReactNode;
  className?: string;
  /** The report is read, not glanced at, so it gets more height than a chart. */
  tall?: boolean;
}) {
  return (
    <div className={`${tall ? "h-[40rem]" : "h-80"} rounded-lg border border-border bg-card p-3 ${className ?? ""}`}>
      <h2 className="mb-2 text-sm font-medium text-muted-foreground">{header}</h2>
      {/* Scroll inside the tile. Without this the report, which is far taller
          than any tile, spilled out past the card's border. */}
      <div className="h-[calc(100%-1.5rem)] overflow-auto">{children}</div>
    </div>
  );
}
