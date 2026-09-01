"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LocalTime } from "@/components/ui/local-time";
import { saveSchedule, type ScheduleState } from "@/lib/api/github";
import { cronLine, taskSchedulerCommand } from "@/lib/schedule/cron";
import {
  DAY_NAMES,
  describeSchedule,
  type Schedule,
} from "@/lib/schedule/types";
import { cn } from "@/lib/utils";

/**
 * Configure the recurring scan.
 *
 * The modal also carries the honest caveat about where the timer lives, and the
 * cron line to use instead. Putting that in the documentation only would mean
 * it is read after the schedule silently failed to fire, rather than before.
 */
export function ScheduleDialog({
  open,
  onOpenChange,
  state,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The stored schedule, already loaded by the parent. */
  state: ScheduleState;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  /**
   * The draft is seeded once, on mount.
   *
   * The parent keys this component on the stored updatedAt, so a schedule
   * changed elsewhere remounts it with fresh values. That is deliberately not
   * an effect copying server state into local state: that pattern needs a
   * dependency list to decide when an in-progress edit may be discarded, and
   * getting it wrong either throws away typing or shows stale values.
   */
  const [draft, setDraft] = useState<Schedule>(() => ({
    enabled: state.enabled,
    mode: state.mode,
    intervalValue: state.intervalValue,
    intervalUnit: state.intervalUnit,
    timesOfDay: state.timesOfDay,
    daysOfWeek: state.daysOfWeek,
    dayOfMonth: state.dayOfMonth,
    timezone: state.timezone,
    windowMode: state.windowMode,
    windowDays: state.windowDays,
  }));

  const save = useMutation({
    mutationFn: () => saveSchedule(draft),
    onMutate: () => {
      setError(null);
      setSaved(false);
    },
    onSuccess: (result) => {
      queryClient.setQueryData(["schedule"], result);
      setSaved(true);
    },
    onError: (e: Error) => setError(e.message),
  });

  const set = <K extends keyof Schedule>(key: K, value: Schedule[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const cron = cronLine(draft);
  const windows = taskSchedulerCommand(draft);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogTitle>Scheduled scans</DialogTitle>
        <DialogDescription>
          Run a scan automatically instead of clicking Refresh. Scans spend GitHub API quota, so
          pick a cadence and a window you are happy to pay for repeatedly.
        </DialogDescription>

        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
            <div className="flex items-center gap-3 rounded-md border border-border p-2.5">
              <Switch
                id="sched-enabled"
                checked={draft.enabled}
                onCheckedChange={(v) => set("enabled", v)}
              />
              <Label htmlFor="sched-enabled" className="text-sm text-foreground">
                {draft.enabled ? describeSchedule(draft) : "Scheduled scans are off"}
              </Label>
              {state.nextRunAt && draft.enabled && (
                <span className="ml-auto text-xs text-muted-foreground">
                  Next: <LocalTime value={state.nextRunAt} />
                </span>
              )}
            </div>

            {/* ------------------------------------------------- cadence */}
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <Label>Repeat</Label>
                <Select value={draft.mode} onValueChange={(v) => set("mode", v as Schedule["mode"])}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="interval">Every N</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {draft.mode === "interval" && (
                <>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="interval">Every</Label>
                    <Input
                      id="interval"
                      type="number"
                      min={1}
                      max={365}
                      className="w-20"
                      value={draft.intervalValue}
                      onChange={(e) => set("intervalValue", Math.max(1, Number(e.target.value) || 1))}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label>Unit</Label>
                    <Select
                      value={draft.intervalUnit}
                      onValueChange={(v) => set("intervalUnit", v as Schedule["intervalUnit"])}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="hours">Hours</SelectItem>
                        <SelectItem value="days">Days</SelectItem>
                        <SelectItem value="weeks">Weeks</SelectItem>
                        <SelectItem value="months">Months</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}

              {draft.mode === "monthly" && (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="dom">Day of month</Label>
                  <Input
                    id="dom"
                    type="number"
                    min={1}
                    max={31}
                    className="w-20"
                    value={draft.dayOfMonth}
                    onChange={(e) => set("dayOfMonth", Math.min(31, Math.max(1, Number(e.target.value) || 1)))}
                  />
                </div>
              )}

              {draft.mode !== "interval" && (
                <div className="flex flex-col gap-1">
                  <Label>Timezone</Label>
                  <Input
                    className="w-52"
                    value={draft.timezone}
                    onChange={(e) => set("timezone", e.target.value)}
                    placeholder="Europe/London"
                    list="tz-suggestions"
                  />
                  <datalist id="tz-suggestions">
                    {[
                      Intl.DateTimeFormat().resolvedOptions().timeZone,
                      "UTC",
                      "America/New_York",
                      "America/Toronto",
                      "Europe/London",
                      "Asia/Kolkata",
                    ]
                      .filter(Boolean)
                      .map((tz) => (
                        <option key={tz} value={tz} />
                      ))}
                  </datalist>
                </div>
              )}
            </div>

            {draft.mode === "weekly" && (
              <div className="flex flex-col gap-1">
                <Label>On</Label>
                <div className="flex flex-wrap gap-1">
                  {DAY_NAMES.map((name, index) => {
                    const on = draft.daysOfWeek.includes(index);
                    return (
                      <Button
                        key={name}
                        size="sm"
                        variant={on ? "default" : "outline"}
                        onClick={() =>
                          set(
                            "daysOfWeek",
                            on
                              ? draft.daysOfWeek.filter((d) => d !== index)
                              : [...draft.daysOfWeek, index]
                          )
                        }
                      >
                        {name.slice(0, 3)}
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}

            {draft.mode !== "interval" && (
              <TimesOfDay value={draft.timesOfDay} onChange={(v) => set("timesOfDay", v)} />
            )}

            {/* -------------------------------------------------- window */}
            <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
              <div className="flex flex-col gap-1">
                <Label>Scan window</Label>
                <Select
                  value={draft.windowMode}
                  onValueChange={(v) => set("windowMode", v as Schedule["windowMode"])}
                >
                  <SelectTrigger className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rolling">Recent window</SelectItem>
                    <SelectItem value="since-last-success">Since the last successful run</SelectItem>
                    <SelectItem value="full">Everything configured</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {draft.windowMode !== "full" && (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="window-days">
                    {draft.windowMode === "rolling" ? "Days back" : "Days back on first run"}
                  </Label>
                  <Input
                    id="window-days"
                    type="number"
                    min={1}
                    max={3650}
                    className="w-24"
                    value={draft.windowDays}
                    onChange={(e) => set("windowDays", Math.max(1, Number(e.target.value) || 1))}
                  />
                </div>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              {draft.windowMode === "rolling" &&
                "Each run covers the last N days. Cheapest option: enrichment is incremental, so re-covering the same days costs almost nothing."}
              {draft.windowMode === "since-last-success" &&
                "Each run covers the period since the last run that actually succeeded, with a day of overlap. A failed run leaves its gap for the next one rather than skipping it."}
              {draft.windowMode === "full" &&
                "Each run covers the whole configured period. Thorough, but over several years this will usually stop early on the rate-limit budget and continue next time."}
            </p>

            {/* --------------------------------------------- last outcome */}
            {state.lastRunAt && (
              <div className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
                Last run <LocalTime value={state.lastRunAt} />
                {state.lastStatus && (
                  <>
                    {" - "}
                    <span className={state.lastStatus === "error" ? "text-destructive" : ""}>
                      {state.lastStatus}
                    </span>
                  </>
                )}
                {state.lastMessage && <div className="mt-0.5">{state.lastMessage}</div>}
              </div>
            )}

            {/* ------------------------------------------ the constraint */}
            <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <div>
                <p>
                  The timer runs inside this server process. That works on a single long-running
                  server. On serverless it never fires, and behind several instances each one fires
                  its own scan against the same rate limit.
                </p>
                {cron ? (
                  <p className="mt-1.5">
                    For those, run the CLI from the operating system instead:
                    <code className="mt-1 block overflow-x-auto rounded bg-background/60 p-1.5 font-mono text-[11px]">
                      {cron}
                    </code>
                    {windows && (
                      <code className="mt-1 block overflow-x-auto rounded bg-background/60 p-1.5 font-mono text-[11px]">
                        {windows}
                      </code>
                    )}
                  </p>
                ) : (
                  <p className="mt-1.5">{state.cronNote ?? "This cadence has no exact cron equivalent."}</p>
                )}
              </div>
            </div>

            {error && (
              <p className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {error}
              </p>
            )}

            {saved && (
              <p className="flex gap-2 rounded-md border border-emerald-600/40 bg-emerald-600/10 p-2 text-xs text-emerald-500">
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
                Saved.
                {state.nextRunAt && draft.enabled && (
                  <>
                    {" "}
                    Next run <LocalTime value={state.nextRunAt} />.
                  </>
                )}
              </p>
            )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending && <Loader2 className="animate-spin" />}
            Save schedule
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** One or more "HH:mm" entries. Several is how "a few times a day" is expressed. */
function TimesOfDay({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <Label>At</Label>
      <div className="flex flex-wrap items-center gap-2">
        {value.map((time, index) => (
          <div key={index} className="flex items-center gap-1">
            <Input
              type="time"
              className="w-32"
              value={time}
              onChange={(e) => {
                const next = [...value];
                next[index] = e.target.value;
                onChange(next);
              }}
            />
            {value.length > 1 && (
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => onChange(value.filter((_, i) => i !== index))}
                aria-label="Remove this time"
              >
                &times;
              </button>
            )}
          </div>
        ))}
        <Button
          size="sm"
          variant="outline"
          className={cn(value.length >= 24 && "hidden")}
          onClick={() => onChange([...value, "18:00"])}
        >
          Add a time
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Add more than one to scan several times a day.
      </p>
    </div>
  );
}
