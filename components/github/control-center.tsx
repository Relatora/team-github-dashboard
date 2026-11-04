"use client";

import { FileDown, FileText, RefreshCw, RotateCcw, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/ui/multi-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MONTH_NAMES, type Filters, type Period } from "@/lib/dashboard/filters";
import type { RosterUser } from "@/lib/api/github";

/**
 * Filters and actions for the dashboard.
 *
 * Ported from ControlCenter.jsx. The custom date range is developer-only, as it
 * was in the source: it is the control most likely to produce a range nobody
 * meant to ask for.
 */

const PERIODS: Array<{ value: Period; label: string }> = [
  { value: "month", label: "By Month" },
  { value: "quarter", label: "By Quarter" },
  { value: "year", label: "Full Year" },
];

const QUARTERS = [
  { value: "1", label: "Q1 (Jan-Mar)" },
  { value: "2", label: "Q2 (Apr-Jun)" },
  { value: "3", label: "Q3 (Jul-Sep)" },
  { value: "4", label: "Q4 (Oct-Dec)" },
];

const ALL_YEARS = "all";

export function ControlCenter({
  filters,
  onChange,
  roster,
  isFetching,
  isScanning,
  isExporting,
  isDeveloper,
  showCustomRange = isDeveloper,
  onRefresh,
  onExportPdf,
  onExportMarkdown,
  onResetLayout,
}: {
  filters: Filters & { users: string[] };
  onChange: (patch: Partial<Filters>) => void;
  roster: RosterUser[];
  isFetching: boolean;
  isScanning: boolean;
  isExporting: boolean;
  isDeveloper: boolean;
  /**
   * Whether the Custom range period option appears. Defaults to isDeveloper
   * (unchanged behaviour for the real dashboard), but the two are separate
   * controls: the public demo shows Custom range without isDeveloper ever
   * being true, since that flag also decides whether Refresh data (a scan)
   * renders, and nothing under /demo may trigger one.
   */
  showCustomRange?: boolean;
  onRefresh: () => void;
  onExportPdf: () => void;
  onExportMarkdown: () => void;
  onResetLayout: () => void;
}) {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 7 }, (_, i) => currentYear - i);

  const periodOptions = showCustomRange
    ? [...PERIODS, { value: "custom" as Period, label: "Custom range" }]
    : PERIODS;

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-1.5 self-center text-sm font-medium">
        <SlidersHorizontal className="size-4" />
        Filters
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="year">Year</Label>
        <Select
          value={filters.year === "" ? ALL_YEARS : String(filters.year)}
          onValueChange={(v) => onChange({ year: v === ALL_YEARS ? "" : Number(v) })}
        >
          <SelectTrigger id="year" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_YEARS}>All Years</SelectItem>
            {years.map((year) => (
              <SelectItem key={year} value={String(year)}>
                {year}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="period">Period</Label>
        <Select
          value={filters.period}
          onValueChange={(v) => onChange({ period: v as Period })}
          // With no year selected there is no sub-period to choose, unless the
          // developer custom range is already active.
          disabled={!filters.year && filters.period !== "custom"}
        >
          <SelectTrigger id="period" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {periodOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filters.period === "month" && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="month">Month</Label>
          <Select
            value={String(filters.month || "")}
            onValueChange={(v) => onChange({ month: Number(v) })}
            disabled={!filters.year}
          >
            <SelectTrigger id="month" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTH_NAMES.map((name, index) => (
                <SelectItem key={name} value={String(index + 1)}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {filters.period === "quarter" && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="quarter">Quarter</Label>
          <Select
            value={String(filters.quarter || "")}
            onValueChange={(v) => onChange({ quarter: Number(v) })}
            disabled={!filters.year}
          >
            <SelectTrigger id="quarter" className="w-40">
              <SelectValue placeholder="Choose" />
            </SelectTrigger>
            <SelectContent>
              {QUARTERS.map((q) => (
                <SelectItem key={q.value} value={q.value}>
                  {q.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {filters.period === "custom" && (
        <>
          <div className="flex flex-col gap-1">
            <Label htmlFor="from">From</Label>
            <Input
              id="from"
              type="date"
              className="w-40"
              value={filters.startDate}
              onChange={(e) => onChange({ startDate: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="to">To</Label>
            <Input
              id="to"
              type="date"
              className="w-40"
              value={filters.endDate}
              onChange={(e) => onChange({ endDate: e.target.value })}
            />
          </div>
        </>
      )}

      <div className="flex min-w-64 flex-1 flex-col gap-1">
        <Label>Users</Label>
        <MultiSelect
          options={roster.map((u) => ({ value: u.handle, label: u.name }))}
          value={filters.users}
          onChange={(users) => onChange({ users })}
          placeholder="Everyone in the data"
          emptyText="No authors in the data yet. Run a scan."
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        {isFetching && <span className="text-xs text-muted-foreground">Updating</span>}

        <Button variant="outline" size="sm" onClick={onExportPdf} title="Export the dashboard as a PDF">
          <FileDown />
          PDF
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={onExportMarkdown}
          disabled={isExporting}
          title="Download the report as Markdown"
        >
          <FileText />
          {isExporting ? "Building" : "Markdown"}
        </Button>

        {isDeveloper && (
          <Button
            size="sm"
            onClick={onRefresh}
            disabled={isScanning}
            title="Scan GitHub for the period on screen"
          >
            <RefreshCw className={isScanning ? "animate-spin" : undefined} />
            {isScanning ? "Scanning" : "Refresh data"}
          </Button>
        )}

        <Button variant="ghost" size="sm" onClick={onResetLayout} title="Restore the default tile arrangement">
          <RotateCcw />
          Reset layout
        </Button>
      </div>
    </div>
  );
}
