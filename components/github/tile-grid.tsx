"use client";

import { useMemo, type ReactNode } from "react";
import {
  Responsive,
  useContainerWidth,
  verticalCompactor,
  type Layout,
  type LayoutItem,
  type ResponsiveLayouts,
} from "react-grid-layout";
import { GripHorizontal } from "lucide-react";
import "react-grid-layout/css/styles.css";

/**
 * Draggable, resizable dashboard tiles.
 *
 * Replaces Kendo's TileLayout. The source had to hand-write a first-fit packing
 * routine and swap-on-drop logic because Kendo let tiles overlap;
 * react-grid-layout does collision handling and compaction itself, so none of
 * that has an equivalent here and none is needed.
 *
 * This targets react-grid-layout v2, which groups drag and resize options into
 * config objects and replaces the WidthProvider HOC with the useContainerWidth
 * hook. The responsive wrapper still takes rowHeight and margin directly,
 * because those vary per breakpoint.
 */

export type Tile = {
  id: string;
  header: string;
  body: ReactNode;
};

export type TileLayouts = ResponsiveLayouts<string>;

const BREAKPOINTS = { lg: 1200, md: 900, sm: 640, xs: 0 };
const COLS = { lg: 12, md: 8, sm: 4, xs: 2 };

export function TileGrid({
  tiles,
  layouts,
  onLayoutChange,
  onInteractionEnd,
  rowHeight = 110,
}: {
  tiles: Tile[];
  layouts: TileLayouts;
  onLayoutChange: (layouts: TileLayouts) => void;
  /**
   * Fired only when a person finishes dragging or resizing.
   *
   * onLayoutChange also fires on mount, on breakpoint changes, and on any
   * programmatic update, so it cannot be used to decide when to persist.
   */
  onInteractionEnd?: () => void;
  rowHeight?: number;
}) {
  // The grid needs a measured container width, which is not available during a
  // server render. measureBeforeMount holds off the first paint so tiles never
  // flash at the wrong size.
  const { width, mounted, containerRef } = useContainerWidth({ measureBeforeMount: true });

  const children = useMemo(
    () =>
      tiles.map((tile) => (
        <div
          key={tile.id}
          className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm"
        >
          {/* Dragging starts from the header only, so body text stays
              selectable. Kendo needed an ignoreDrag predicate that also had to
              allow the resize handles, and getting that subtly wrong silently
              disabled resizing. Here the handle is named and resize is separate. */}
          <div className="tile-drag-handle flex cursor-grab items-center gap-2 border-b border-border px-3 py-2 active:cursor-grabbing">
            <GripHorizontal className="size-3.5 shrink-0 text-muted-foreground" />
            <h2 className="truncate text-sm font-medium">{tile.header}</h2>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">{tile.body}</div>
        </div>
      )),
    [tiles]
  );

  return (
    <div ref={containerRef}>
      {mounted && (
        <Responsive
          width={width}
          layouts={layouts}
          breakpoints={BREAKPOINTS}
          cols={COLS}
          rowHeight={rowHeight}
          margin={[12, 12]}
          dragConfig={{ handle: ".tile-drag-handle" }}
          resizeConfig={{ handles: ["se"] }}
          // Vertical compaction is what closes the hole left when a tile is
          // dragged away, and it is why the manual reflow from the source is
          // gone rather than ported.
          compactor={verticalCompactor}
          onLayoutChange={(_current: Layout, all: ResponsiveLayouts<string>) => onLayoutChange(all)}
          onDragStop={() => onInteractionEnd?.()}
          onResizeStop={() => onInteractionEnd?.()}
        >
          {children}
        </Responsive>
      )}
      {!mounted && (
        <div className="grid gap-3 md:grid-cols-2">
          {tiles.map((tile) => (
            <div key={tile.id} className="h-72 rounded-lg border border-border bg-card" />
          ))}
        </div>
      )}
    </div>
  );
}

export type { Layout, LayoutItem };
