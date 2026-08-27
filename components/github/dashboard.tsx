"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ControlCenter } from "./control-center";
import { DeveloperPanel } from "./developer-panel";
import { KpiRow, buildKpiCards } from "./kpi-row";
import { ReportView } from "./report-view";
import { TileGrid, type Tile, type TileLayouts } from "./tile-grid";
import { PrintDocument } from "./print-document";
import { LocalTime } from "@/components/ui/local-time";
import { CategoryBarChart, CategoryDonutChart, PALETTE, TimeSeriesChart } from "@/components/charts";

import {
  getMetrics,
  getReport,
  getRuns,
  getScanStatus,
  getSettings,
  getUsers,
  saveSettings,
  startScan,
  type Metrics,
} from "@/lib/api/github";
import { CATEGORY_COLORS } from "@/lib/github/categorize";
import {
  DEFAULT_LAYOUTS,
  clearLayouts,
  loadLayouts,
  saveLayouts,
} from "@/lib/dashboard/layout";
import {
  DEFAULT_FILTERS,
  applyFilterChange,
  fileStamp,
  filtersToDateRange,
  periodLabel,
  type Filters,
} from "@/lib/dashboard/filters";
import { consolidateByProject, nameFrom } from "@/lib/dashboard/projects";
import { DEFAULT_DEV_SETTINGS, type ResolvedDevSettings } from "@/lib/settings/types";
import { exportPdf } from "@/lib/dashboard/export-pdf";
import type { SessionUser } from "@/lib/auth/roles";
import { hasRole } from "@/lib/auth/roles";

/**
 * The GitHub work dashboard.
 *
 * Ported from GitHub.jsx. The largest structural change is that layout
 * arrangement, tile packing, and swap-on-drop are gone: react-grid-layout does
 * all of it, so what remains here is data, filters, and export.
 */

const NO_USERS = "__none__";
const TOP_N = 15;

export function Dashboard({ user }: { user: SessionUser }) {
  const queryClient = useQueryClient();
  const isDeveloper = hasRole(user.roles, "developer");

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  // Read straight from storage on the first client render. This is safe even
  // though the server cannot see localStorage, because the grid does not paint
  // until useContainerWidth reports a measured width, so there is no server
  // markup to mismatch.
  const [layouts, setLayouts] = useState<TileLayouts>(loadLayouts);
  const [scanJobId, setScanJobId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const { data: settings = { ...DEFAULT_DEV_SETTINGS, source: "default" } as ResolvedDevSettings } =
    useQuery({ queryKey: ["settings"], queryFn: getSettings });

  const { data: roster = [], isSuccess: rosterLoaded } = useQuery({
    queryKey: ["roster"],
    queryFn: getUsers,
  });

  const { data: runs } = useQuery({ queryKey: ["runs"], queryFn: () => getRuns(1) });
  const lastRun = runs?.[0];

  /**
   * The pool of authors selectable in the Users control: the curated whitelist
   * if one is set, otherwise everyone in the data. A whitelist that matches
   * nobody falls back to the full roster rather than emptying the control,
   * which would look broken.
   */
  const availableRoster = useMemo(() => {
    const shown = settings.shownUsers.map((h) => h.toLowerCase());
    if (!shown.length) return roster;
    const filtered = roster.filter((u) => shown.includes(u.handle.toLowerCase()));
    return filtered.length ? filtered : roster;
  }, [roster, settings.shownUsers]);

  /**
   * The effective selection.
   *
   * `filters.users === null` means "not chosen yet", which resolves to everyone
   * available. That is deliberately different from `[]`, which is a user who
   * deselected everybody and must get an empty dashboard rather than silently
   * seeing the whole organization again.
   *
   * Deriving this rather than seeding state from the roster once it loads
   * avoids an effect whose only job is to copy one piece of state into another,
   * and with it the stale-copy bug that pattern invites.
   *
   * The filter also clamps to the available pool, so chips outside a narrowed
   * whitelist drop out on their own.
   */
  const selectedUsers = useMemo(() => {
    const pool = availableRoster.map((u) => u.handle.toLowerCase());
    const base = filters.users ?? availableRoster.map((u) => u.handle);
    return base.filter((h) => pool.includes(h.toLowerCase()));
  }, [filters.users, availableRoster]);

  // The server falls back to a default roster on an empty user list, so a
  // deliberate "nobody" has to send a sentinel that matches no author.
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
      calc: settings.calcMode,
    }),
    [isCustom, filters, usersParam, settings.calcMode]
  );

  const {
    data: metrics,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ["metrics", metricsParams],
    queryFn: () => getMetrics(metricsParams),
    placeholderData: (previous) => previous,
  });

  const reportBody = useMemo(
    () => ({
      users: selectedUsers.length ? selectedUsers : [NO_USERS],
      audience: "leadership" as const,
      calc: settings.calcMode,
      show_removed: settings.showRemoved,
      ...filtersToDateRange(filters),
    }),
    [selectedUsers, filters, settings.calcMode, settings.showRemoved]
  );

  const {
    data: reportMd,
    isFetching: reportFetching,
    error: reportError,
  } = useQuery({
    queryKey: ["report", reportBody],
    queryFn: () => getReport(reportBody),
    // Wait for the roster. Until it arrives the selection is empty, which sends
    // the "nobody" sentinel and returns 409, flashing a needs-a-scan message at
    // someone whose data is about to load fine.
    enabled: rosterLoaded,
    placeholderData: (previous) => previous,
    // A 409 means "no data yet", which is a stable answer. Retrying it wastes
    // requests and delays the message telling the user to run a scan.
    retry: false,
  });

  /** Poll a running scan, backing off once it is clearly a long one. */
  useQuery({
    queryKey: ["scan", scanJobId],
    queryFn: async () => {
      const status = await getScanStatus(scanJobId!);
      if (status.status === "done") {
        setScanJobId(null);
        toast.success(status.message);
        if (status.incomplete) {
          toast.warning("The scan stopped early on the GitHub rate limit. Run it again to continue.");
        }
        // A scan can introduce authors who were not in the data before, so the
        // roster is invalidated too. Without that, a newly fetched person only
        // appears after a full page reload.
        for (const key of ["metrics", "report", "runs", "roster"]) {
          queryClient.invalidateQueries({ queryKey: [key] });
        }
      } else if (status.status === "error") {
        setScanJobId(null);
        toast.error(`Scan failed: ${status.message}`);
      }
      return status;
    },
    enabled: Boolean(scanJobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "done" || status === "error") return false;
      // Every five seconds for the first half minute, then every fifteen. A
      // scan can run for many minutes and does not need constant polling.
      return (query.state.dataUpdateCount ?? 0) < 6 ? 5000 : 15000;
    },
    refetchIntervalInBackground: false,
  });

  const settingsMutation = useMutation({
    mutationFn: ({ scope, patch }: { scope: "me" | "everyone"; patch: Partial<ResolvedDevSettings> }) =>
      saveSettings(scope, {
        calcMode: settings.calcMode,
        showRemoved: settings.showRemoved,
        showIssues: settings.showIssues,
        shownUsers: settings.shownUsers,
        ...patch,
      }),
    onSuccess: (updated, variables) => {
      queryClient.setQueryData(["settings"], updated);
      queryClient.invalidateQueries({ queryKey: ["metrics"] });
      queryClient.invalidateQueries({ queryKey: ["report"] });
      toast.success(variables.scope === "everyone" ? "Saved for everyone." : "Saved for you.");
    },
    onError: () => toast.error("Could not save the setting."),
  });

  const handleFilterChange = useCallback((patch: Partial<Filters>) => {
    setFilters((previous) => applyFilterChange(previous, patch));
  }, []);

  /**
   * Layout persistence is driven by user gestures, not by layout changes.
   *
   * onLayoutChange also fires on mount, on breakpoint changes, and on any
   * programmatic update. Saving from it made Reset layout impossible: clearing
   * storage immediately triggered a change event that wrote the cleared layout
   * straight back.
   *
   * So the latest layout is tracked in a ref, and only the end of a drag or a
   * resize commits it. The ref covers either callback order, since the grid
   * does not promise whether the change or the gesture-end fires first.
   */
  const latestLayouts = useRef(layouts);

  /**
   * Bumped by Reset layout to force the grid to remount.
   *
   * react-grid-layout keeps its own copy of the layout after mount and does not
   * re-read the prop, so setting state alone clears storage without moving a
   * single tile. Remounting is what actually applies the defaults.
   */
  const [layoutVersion, setLayoutVersion] = useState(0);

  const handleLayoutChange = useCallback((next: TileLayouts) => {
    latestLayouts.current = next;
    setLayouts(next);
  }, []);

  const handleInteractionEnd = useCallback(() => {
    saveLayouts(latestLayouts.current);
  }, []);

  const handleResetLayout = useCallback(() => {
    latestLayouts.current = DEFAULT_LAYOUTS;
    setLayouts(DEFAULT_LAYOUTS);
    setLayoutVersion((v) => v + 1);
    clearLayouts();
    toast.info("Layout reset.");
  }, []);

  /**
   * Scan exactly the period on screen.
   *
   * Sending the range explicitly means a refresh never depends on the config's
   * own end date, which drifts into the past and silently excludes recent work.
   */
  const handleRefresh = useCallback(async () => {
    const range = filtersToDateRange(filters);
    try {
      const { job_id } = await startScan({ users: selectedUsers, ...range });
      setScanJobId(job_id);
      toast.info(
        range.start_date
          ? `Scanning ${range.start_date} to ${range.end_date} in the background.`
          : "Scanning the configured period in the background."
      );
    } catch {
      toast.error("Could not start a scan.");
    }
  }, [filters, selectedUsers]);

  const handleFetchUsers = useCallback(async (logins: string[]) => {
    if (!logins.length) return;
    try {
      const { job_id } = await startScan({ users: logins });
      setScanJobId(job_id);
      toast.info(`Scanning ${logins.length} people in the background.`);
    } catch {
      toast.error("Could not start a scan.");
    }
  }, []);

  const userSlug = selectedUsers.join("-") || "all";

  const handleExportMarkdown = useCallback(async () => {
    setIsExporting(true);
    try {
      const markdown = await getReport(reportBody);
      const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `github_report_${userSlug}_${fileStamp()}.md`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success("Markdown downloaded.");
    } catch {
      toast.error("Could not build the Markdown report.");
    } finally {
      setIsExporting(false);
    }
  }, [reportBody, userSlug]);

  const handleExportPdf = useCallback(async () => {
    if (!printRef.current) return;
    setIsExporting(true);
    try {
      await exportPdf(printRef.current, `github_dashboard_${userSlug}_${fileStamp()}.pdf`);
      toast.success("PDF downloaded.");
    } catch (error) {
      console.error(error);
      toast.error("Could not build the PDF.");
    } finally {
      setIsExporting(false);
    }
  }, [userSlug]);

  // --- Derived chart data ---------------------------------------------------

  const shortRepo = (row: { _id: string; count: number }) => ({
    _id: String(row._id).split("/").pop() ?? row._id,
    count: row.count,
  });

  const byRepo = (metrics?.byRepo ?? []).slice(0, TOP_N).map(shortRepo);
  // Consolidation runs over the FULL repository list, not the top slice: a
  // client and server pair whose halves each fall below the cutoff still totals
  // above it, and slicing first would lose the project entirely.
  const byProject = consolidateByProject(metrics?.byRepo ?? []).slice(0, TOP_N);
  const linesByProject = consolidateByProject(metrics?.linesByRepo ?? []).slice(0, TOP_N);
  const byAuthor = (metrics?.byAuthor ?? []).map((d) => ({ ...d, _id: nameFrom(roster, d._id) }));
  const linesByAuthor = (metrics?.linesByAuthor ?? []).map((d) => ({
    ...d,
    _id: nameFrom(roster, d._id),
  }));

  const kpiCards = buildKpiCards(metrics?.kpis, {
    showRemoved: settings.showRemoved,
    showIssues: settings.showIssues,
  });

  const tiles: Tile[] = [
    {
      id: "commitsOverTime",
      header: "Commits Over Time",
      body: <TimeSeriesChart data={metrics?.commitsOverTime} type="line" name="Commits" color="#0d6efd" />,
    },
    {
      id: "byCategory",
      header: "Commits by Category",
      body: (
        <CategoryDonutChart
          data={metrics?.byCategory}
          colorByCategory={(c, i) => CATEGORY_COLORS[c] ?? PALETTE[i % PALETTE.length]}
        />
      ),
    },
    {
      id: "byRepo",
      header: `Commits by Repository (top ${TOP_N})`,
      body: <CategoryBarChart data={byRepo} color="#6f42c1" horizontal />,
    },
    { id: "byAuthor", header: "Commits by Author", body: <CategoryDonutChart data={byAuthor} /> },
    {
      id: "byProject",
      header: `Commits by Project (top ${TOP_N})`,
      body: <CategoryBarChart data={byProject} color="#20c997" horizontal />,
    },
    {
      id: "linesByProject",
      header: `Lines Added by Project (top ${TOP_N})`,
      body: <CategoryBarChart data={linesByProject} color="#198754" horizontal />,
    },
    {
      id: "linesByAuthor",
      header: "Lines Added by Author",
      body: <CategoryDonutChart data={linesByAuthor} />,
    },
    {
      id: "linesOverTime",
      header: "Lines Added Over Time",
      body: (
        <TimeSeriesChart data={metrics?.linesOverTime} type="column" name="lines added" color="#198754" />
      ),
    },
    {
      id: "workReport",
      header: "Work Report",
      body: <ReportView markdown={reportMd} isLoading={reportFetching} error={reportError} />,
    },
  ];

  return (
    <div className="mx-auto max-w-[1800px]">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">GitHub Work Dashboard</h1>
        <p className="text-xs text-muted-foreground">
          {lastRun ? <>Last synced <LocalTime value={lastRun.generatedAt} /></> : "No scan recorded yet"}
        </p>
      </div>

      <ControlCenter
        filters={{ ...filters, users: selectedUsers }}
        onChange={handleFilterChange}
        roster={availableRoster}
        isFetching={isFetching}
        isScanning={Boolean(scanJobId)}
        isExporting={isExporting}
        isDeveloper={isDeveloper}
        onRefresh={handleRefresh}
        onExportPdf={handleExportPdf}
        onExportMarkdown={handleExportMarkdown}
        onResetLayout={handleResetLayout}
      />

      {isDeveloper && (
        <DeveloperPanel
          settings={settings}
          roster={roster}
          isScanning={Boolean(scanJobId)}
          onSave={(scope, patch) => settingsMutation.mutate({ scope, patch })}
          onFetchUsers={handleFetchUsers}
        />
      )}

      <KpiRow cards={kpiCards} />

      {isLoading && !metrics ? (
        <div className="grid gap-3 md:grid-cols-2">
          {tiles.map((tile) => (
            <div key={tile.id} className="h-72 animate-pulse rounded-lg border border-border bg-card" />
          ))}
        </div>
      ) : (
        <TileGrid
          key={layoutVersion}
          tiles={tiles}
          layouts={layouts}
          onLayoutChange={handleLayoutChange}
          onInteractionEnd={handleInteractionEnd}
        />
      )}

      {/* Off-screen print document, captured by Export PDF. */}
      <PrintDocument
        ref={printRef}
        title="GitHub Work Dashboard"
        metaLines={[
          `Users: ${selectedUsers.map((h) => nameFrom(roster, h)).join(", ") || "all"}`,
          `Period: ${periodLabel(filters)}`,
          lastRun
            ? `Last synced: ${new Date(lastRun.generatedAt).toISOString().slice(0, 16).replace("T", " ")} UTC`
            : null,
          `Counting: ${settings.calcMode}`,
          `Generated: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
        ].filter((line): line is string => Boolean(line))}
        kpiCards={kpiCards}
        metrics={metrics as Metrics | undefined}
        byRepo={byRepo}
        byProject={byProject}
        linesByProject={linesByProject}
        byAuthor={byAuthor}
        linesByAuthor={linesByAuthor}
        reportMd={reportMd}
      />
    </div>
  );
}
