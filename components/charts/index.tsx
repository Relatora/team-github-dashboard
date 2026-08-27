"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * The three chart shapes the dashboard needs, on Recharts.
 *
 * Ported from Charts.jsx, which used Kendo. The custom donut legend is kept
 * deliberately: Kendo's built-in legend was disabled because it stole
 * horizontal width and squashed the ring on a narrow tile, and Recharts'
 * default Legend does exactly the same thing.
 */

export const PALETTE = [
  "#0d6efd", "#198754", "#dc3545", "#fd7e14", "#6f42c1",
  "#0dcaf0", "#20c997", "#d63384", "#ffc107", "#6c757d",
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Number formatting is pinned to one locale.
 *
 * An unpinned toLocaleString formats with the server's locale during the server
 * render and the browser's on the client, so "5,569" and "5.569" become a
 * hydration mismatch on any visitor whose locale differs from the host's.
 */
const formatNumber = (value: number) => value.toLocaleString("en-US");

export type CountRow = { _id: string; count: number };
export type TimeRow = { _id: { year: number; month: number }; count: number };

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      No data for the selected filters
    </div>
  );
}

const toCategoryRows = (data: CountRow[] = []) =>
  data
    .filter((d) => d && d._id !== null && d._id !== undefined && d._id !== "")
    .map((d) => ({ category: String(d._id), value: d.count }));

const toTimeRows = (data: TimeRow[] = []) =>
  data.map((d) => ({
    category: `${MONTHS[(d._id.month || 1) - 1]} ${d._id.year}`,
    value: d.count,
  }));

/** Shared tooltip, so every chart reads the same way. */
function ChartTooltip({
  active,
  payload,
  label,
  suffix,
}: {
  active?: boolean;
  payload?: Array<{ value?: number; name?: string; payload?: { category?: string } }>;
  label?: string;
  suffix?: string;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0];
  const name = label ?? point.payload?.category ?? point.name ?? "";
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      <div className="font-medium">{name}</div>
      <div className="text-muted-foreground">
        {formatNumber(point.value ?? 0)}
        {suffix ? ` ${suffix}` : ""}
      </div>
    </div>
  );
}

const axisStyle = { fontSize: 11, fill: "var(--muted-foreground)" };

export function CategoryBarChart({
  data,
  color = PALETTE[0],
  horizontal = false,
}: {
  data?: CountRow[];
  color?: string;
  horizontal?: boolean;
}) {
  const rows = toCategoryRows(data);
  if (!rows.length) return <EmptyState />;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={rows}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={{ top: 4, right: 12, bottom: 4, left: horizontal ? 8 : 0 }}
      >
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" tick={axisStyle} stroke="var(--border)" />
            {/* Repository names are long, so the category axis gets real width
                and the labels stay horizontal and readable. */}
            <YAxis
              type="category"
              dataKey="category"
              width={150}
              tick={axisStyle}
              stroke="var(--border)"
              interval={0}
            />
          </>
        ) : (
          <>
            <XAxis dataKey="category" tick={axisStyle} stroke="var(--border)" interval={0} angle={-30} textAnchor="end" height={60} />
            <YAxis tick={axisStyle} stroke="var(--border)" />
          </>
        )}
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--accent)", opacity: 0.35 }} />
        <Bar dataKey="value" fill={color} radius={3} maxBarSize={26} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Donut with a custom legend listing every slice and its count.
 *
 * Percentages sit on the ring and exact counts sit in the legend, so a thin
 * slice is still identifiable without cramming a label onto it.
 */
export function CategoryDonutChart({
  data,
  colorByCategory,
}: {
  data?: CountRow[];
  colorByCategory?: (category: string, index: number) => string;
}) {
  const rows = toCategoryRows(data).map((row, i) => ({
    ...row,
    color: colorByCategory ? colorByCategory(row.category, i) : PALETTE[i % PALETTE.length],
  }));
  if (!rows.length) return <EmptyState />;

  const total = rows.reduce((sum, r) => sum + (r.value || 0), 0) || 1;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 sm:flex-row">
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip content={<ChartTooltip />} />
            <Pie
              data={rows}
              dataKey="value"
              nameKey="category"
              innerRadius="55%"
              outerRadius="80%"
              paddingAngle={1}
              stroke="var(--card)"
              strokeWidth={2}
              isAnimationActive={false}
              label={({ value }) => {
                const pct = Math.round(((value as number) / total) * 100);
                // Below one percent the label is unreadable and overlaps its
                // neighbours; the legend still carries the exact number.
                return pct >= 1 ? `${pct}%` : "";
              }}
              labelLine={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
            >
              {rows.map((row) => (
                <Cell key={row.category} fill={row.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>

      <ul className="max-h-full shrink-0 overflow-y-auto text-xs sm:w-44">
        {rows.map((row) => (
          <li
            key={row.category}
            className="flex items-center gap-2 py-0.5"
            title={`${row.category}: ${formatNumber(row.value)}`}
          >
            <span
              className="size-2.5 shrink-0 rounded-sm"
              style={{ background: row.color }}
              aria-hidden
            />
            <span className="truncate text-muted-foreground">{row.category}</span>
            <span className="ml-auto shrink-0 tabular-nums">{formatNumber(row.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TimeSeriesChart({
  data,
  color = PALETTE[0],
  type = "line",
  name = "Commits",
}: {
  data?: TimeRow[];
  color?: string;
  type?: "line" | "column";
  name?: string;
}) {
  const rows = toTimeRows(data);
  if (!rows.length) return <EmptyState />;

  const common = (
    <>
      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
      <XAxis dataKey="category" tick={axisStyle} stroke="var(--border)" minTickGap={16} />
      <YAxis tick={axisStyle} stroke="var(--border)" />
      <Tooltip content={<ChartTooltip suffix={name.toLowerCase()} />} cursor={{ stroke: "var(--border)" }} />
    </>
  );

  return (
    <ResponsiveContainer width="100%" height="100%">
      {type === "column" ? (
        <BarChart data={rows} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
          {common}
          <Bar dataKey="value" fill={color} radius={3} maxBarSize={40} />
        </BarChart>
      ) : (
        <LineChart data={rows} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
          {common}
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} />
        </LineChart>
      )}
    </ResponsiveContainer>
  );
}
