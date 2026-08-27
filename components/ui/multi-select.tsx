"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Multi-select with a typeahead, replacing Kendo's MultiSelect.
 *
 * The value is a list of stable keys (GitHub handles), while the list shows
 * human names. Keeping those separate is what lets the label change - a person
 * being given a display name - without invalidating a saved selection.
 */

export type Option = { value: string; label: string };

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = "Select...",
  className,
  emptyText = "Nothing to select",
}: {
  options: Option[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  className?: string;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const byValue = useMemo(
    () => new Map(options.map((o) => [o.value.toLowerCase(), o])),
    [options]
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(needle) || o.value.toLowerCase().includes(needle)
    );
  }, [options, query]);

  const toggle = (option: string) => {
    const isSelected = value.some((v) => v.toLowerCase() === option.toLowerCase());
    onChange(
      isSelected ? value.filter((v) => v.toLowerCase() !== option.toLowerCase()) : [...value, option]
    );
  };

  // A selected value that is no longer in the options still renders as a chip,
  // labelled with the raw key. Silently dropping it would hide from the user
  // that their filter contains something the current data cannot show.
  const chips = value.map((v) => byValue.get(v.toLowerCase()) ?? { value: v, label: v });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-left text-sm shadow-sm",
            "focus:outline-none focus:ring-2 focus:ring-ring",
            className
          )}
        >
          {chips.length === 0 && <span className="px-1 text-muted-foreground">{placeholder}</span>}
          {chips.map((chip) => (
            <span
              key={chip.value}
              className="flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground"
            >
              {chip.label}
              <X
                className="size-3 cursor-pointer opacity-60 hover:opacity-100"
                onClick={(event) => {
                  // Removing a chip must not also open the dropdown.
                  event.stopPropagation();
                  toggle(chip.value);
                }}
              />
            </span>
          ))}
          <ChevronsUpDown className="ml-auto size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <div className="border-b border-border p-1.5">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="h-8"
          />
        </div>

        <ul className="max-h-64 overflow-y-auto p-1">
          {filtered.length === 0 && (
            <li className="px-2 py-3 text-center text-sm text-muted-foreground">{emptyText}</li>
          )}
          {filtered.map((option) => {
            const selected = value.some((v) => v.toLowerCase() === option.value.toLowerCase());
            return (
              <li key={option.value}>
                <button
                  type="button"
                  onClick={() => toggle(option.value)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <span
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-sm border border-input",
                      selected && "border-primary bg-primary text-primary-foreground"
                    )}
                  >
                    {selected && <Check className="size-3" />}
                  </span>
                  <span className="truncate">{option.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
