import type { LayoutItem, ResponsiveLayouts } from "react-grid-layout";

/**
 * v2 names the single tile LayoutItem and the array Layout. Aliasing here keeps
 * the rest of this file reading as "a list of tile placements".
 */
type Placements = LayoutItem[];

/**
 * The dashboard tile set and its default arrangement.
 *
 * The tile ids are the contract between the default layout, the saved layout,
 * and the tiles themselves. Keying by id rather than by array position is what
 * fixes a real problem in the source: layouts were stored as a positional
 * array, so adding or removing one tile invalidated every saved layout and
 * users were stranded until they found the Reset button.
 */

export const TILE_IDS = [
  "commitsOverTime",
  "byCategory",
  "byRepo",
  "byAuthor",
  "byProject",
  "linesByProject",
  "linesByAuthor",
  "linesOverTime",
  "workReport",
] as const;

export type TileId = (typeof TILE_IDS)[number];

/** Bumped only when the default arrangement itself changes meaningfully. */
export const LAYOUT_STORAGE_KEY = "tgd-dashboard-layout-v1";

const lg: Placements = [
  { i: "commitsOverTime", x: 0, y: 0, w: 8, h: 3, minW: 3, minH: 2 },
  { i: "byCategory", x: 8, y: 0, w: 4, h: 3, minW: 3, minH: 2 },
  { i: "byRepo", x: 0, y: 3, w: 8, h: 3, minW: 3, minH: 2 },
  { i: "byAuthor", x: 8, y: 3, w: 4, h: 3, minW: 3, minH: 2 },
  { i: "byProject", x: 0, y: 6, w: 12, h: 3, minW: 3, minH: 2 },
  { i: "linesByProject", x: 0, y: 9, w: 8, h: 3, minW: 3, minH: 2 },
  { i: "linesByAuthor", x: 8, y: 9, w: 4, h: 3, minW: 3, minH: 2 },
  { i: "linesOverTime", x: 0, y: 12, w: 12, h: 3, minW: 3, minH: 2 },
  { i: "workReport", x: 0, y: 15, w: 12, h: 6, minW: 4, minH: 3 },
];

/** Narrower breakpoints stack: side-by-side tiles are unreadable below ~900px. */
const stack = (cols: number): Placements =>
  TILE_IDS.map((id, index) => ({
    i: id,
    x: 0,
    y: index * 3,
    w: cols,
    h: id === "workReport" ? 6 : 3,
    minW: 1,
    minH: 2,
  }));

export const DEFAULT_LAYOUTS: ResponsiveLayouts<string> = {
  lg,
  md: stack(8),
  sm: stack(4),
  xs: stack(2),
};

/**
 * Restore a saved layout, discarding anything that does not describe the
 * current tile set.
 *
 * Rather than rejecting the whole layout when the tile set has changed, missing
 * tiles are appended from the default. So adding a tile keeps the user's
 * arrangement of the others instead of resetting everything they positioned.
 */
export function loadLayouts(): ResponsiveLayouts<string> {
  if (typeof window === "undefined") return DEFAULT_LAYOUTS;

  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUTS;

    const saved = JSON.parse(raw) as Record<string, Placements>;
    const known = new Set<string>(TILE_IDS);
    const merged: Record<string, Placements> = {};

    for (const [breakpoint, fallback] of Object.entries(DEFAULT_LAYOUTS)) {
      const savedForBreakpoint = (saved[breakpoint] ?? []).filter((item) => known.has(item.i));
      const present = new Set(savedForBreakpoint.map((item) => item.i));
      const defaults = [...(fallback ?? [])];
      if (!savedForBreakpoint.length) {
        merged[breakpoint] = defaults;
        continue;
      }

      // Append tiles the saved layout does not know about BELOW everything it
      // does, rather than at their default coordinates. Reusing the defaults
      // means a new tile lands on top of a saved one, and compaction then
      // reshuffles the arrangement the user built. Placing them at the bottom
      // leaves the saved layout intact and puts the new tile somewhere
      // predictable.
      const bottom = savedForBreakpoint.reduce((max, item) => Math.max(max, item.y + item.h), 0);
      let nextY = bottom;
      const missing = defaults
        .filter((item) => !present.has(item.i))
        .map((item) => {
          const placed = { ...item, x: 0, y: nextY };
          nextY += item.h;
          return placed;
        });

      merged[breakpoint] = [...savedForBreakpoint, ...missing];
    }

    return merged;
  } catch {
    // Corrupt or unreadable storage, for example a private window with storage
    // access blocked. A broken saved layout must never stop the page rendering.
    return DEFAULT_LAYOUTS;
  }
}

export function saveLayouts(layouts: ResponsiveLayouts<string>): void {
  try {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layouts));
  } catch {
    // Storage full or disabled. Dragging still works for this session.
  }
}

export function clearLayouts(): void {
  try {
    window.localStorage.removeItem(LAYOUT_STORAGE_KEY);
  } catch {
    // Ignore.
  }
}
