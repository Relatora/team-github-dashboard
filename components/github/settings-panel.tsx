"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  ChevronDown,
  ChevronRight,
  KeyRound,
  RefreshCw,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/ui/multi-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { FetchUsersDialog } from "./fetch-users-dialog";
import { GitHubTokenDialog } from "./github-token-dialog";
import { ScheduleDialog } from "./schedule-dialog";
import { getGitHubTokenStatus, getSchedule, type RosterUser } from "@/lib/api/github";
import type { ResolvedDevSettings } from "@/lib/settings/types";

/**
 * Settings, split into two groups because they answer different questions.
 *
 * **User settings** change what everyone sees on the dashboard: who is on the
 * roster and who is selectable. **Developer settings** change how numbers are
 * presented and how data is collected.
 *
 * Both stay behind the developer role. The split is about making the blast
 * radius of a control obvious, not about who may touch it: someone changing
 * Shown users is changing every viewer's dashboard, and that should not look
 * like the same kind of act as hiding a KPI tile.
 */
export function SettingsPanel({
  settings,
  roster,
  trackedHandles,
  onSave,
  onAddUsers,
  onRemoveUsers,
  onScanTracked,
  isScanning,
}: {
  settings: ResolvedDevSettings;
  roster: RosterUser[];
  trackedHandles: string[];
  onSave: (scope: "me" | "everyone", patch: Partial<ResolvedDevSettings>) => void;
  onAddUsers: (people: Array<{ handle: string; avatarUrl?: string }>) => void;
  onRemoveUsers: (handles: string[]) => void;
  onScanTracked: () => void;
  isScanning: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"me" | "everyone">("me");
  const [addOpen, setAddOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const { data: token } = useQuery({ queryKey: ["githubToken"], queryFn: getGitHubTokenStatus });
  const { data: schedule } = useQuery({ queryKey: ["schedule"], queryFn: getSchedule });

  const sourceLabel =
    settings.source === "user"
      ? "your override"
      : settings.source === "global"
        ? "everyone default"
        : "default";

  const neverScanned = roster.filter((u) => u.neverScanned);

  return (
    <div className="mb-4 rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium"
      >
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        Settings
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          {settings.calcMode} counting, removed {settings.showRemoved ? "shown" : "hidden"} ({sourceLabel})
        </span>
        <span className="ml-auto flex items-center gap-2">
          {neverScanned.length > 0 && (
            <span className="rounded-full border border-sky-500/40 px-2 py-0.5 text-xs font-normal text-sky-500">
              {neverScanned.length} never scanned
            </span>
          )}
          {token && !token.configured && (
            <span className="rounded-full border border-amber-500/40 px-2 py-0.5 text-xs font-normal text-amber-500">
              No GitHub token
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="border-t border-border">
          {/* ------------------------------------------------ user settings */}
          <section className="p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              User settings
            </h3>
            <p className="mb-3 text-xs text-muted-foreground">
              These change what every viewer of the dashboard sees.
            </p>

            <div className="flex flex-wrap items-end gap-4">
              <div className="flex min-w-72 flex-1 flex-col gap-1">
                <Label>Shown users</Label>
                <MultiSelect
                  options={roster.map((u) => ({
                    value: u.handle,
                    label: u.neverScanned ? `${u.name} (never scanned)` : u.name,
                  }))}
                  value={settings.shownUsers}
                  onChange={(shownUsers) => onSave(scope, { shownUsers })}
                  placeholder="Everyone on the roster"
                />
                <p className="text-xs text-muted-foreground">
                  Who appears in the dashboard Users control. Empty means everyone.
                </p>
              </div>

              <div className="flex flex-col gap-1">
                <Label>Apply to</Label>
                <Select value={scope} onValueChange={(v) => setScope(v as "me" | "everyone")}>
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="me">Just me</SelectItem>
                    <SelectItem value="everyone">Everyone</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1">
                <Label>Roster</Label>
                <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
                  <Users />
                  Add people
                </Button>
              </div>

              <div className="flex flex-col gap-1">
                <Label>Collect</Label>
                <Button
                  size="sm"
                  variant={neverScanned.length ? "default" : "outline"}
                  onClick={onScanTracked}
                  disabled={isScanning}
                  title="Scan everyone on the roster over the full configured window, not the period on screen"
                >
                  <RefreshCw className={isScanning ? "animate-spin" : undefined} />
                  {isScanning ? "Scanning" : "Scan tracked people"}
                </Button>
              </div>
            </div>

            {trackedHandles.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">On the roster:</span>
                {roster
                  .filter((u) => u.tracked)
                  .map((u) => (
                    <span
                      key={u.handle}
                      className="flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-xs"
                    >
                      {u.name}
                      {u.neverScanned && <span className="text-sky-500">new</span>}
                      <button
                        type="button"
                        onClick={() => onRemoveUsers([u.handle])}
                        className="opacity-60 hover:opacity-100"
                        title={`Remove ${u.name} from the roster`}
                        aria-label={`Remove ${u.name} from the roster`}
                      >
                        &times;
                      </button>
                    </span>
                  ))}
              </div>
            )}
          </section>

          <Separator />

          {/* ------------------------------------------- developer settings */}
          <section className="p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Developer settings
            </h3>
            <p className="mb-3 text-xs text-muted-foreground">
              How the numbers are presented, and how data is collected.
            </p>

            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-1">
                <Label>Counting</Label>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant={settings.calcMode === "cleaned" ? "default" : "outline"}
                    onClick={() => onSave(scope, { calcMode: "cleaned" })}
                    title="Exclude generated and vendored files, and count merge commits as zero"
                  >
                    Cleaned
                  </Button>
                  <Button
                    size="sm"
                    variant={settings.calcMode === "raw" ? "default" : "outline"}
                    onClick={() => onSave(scope, { calcMode: "raw" })}
                    title="Raw GitHub diff totals, including generated files and merges"
                  >
                    Raw
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <Label>Lines removed</Label>
                <Button
                  size="sm"
                  variant={settings.showRemoved ? "default" : "outline"}
                  onClick={() => onSave(scope, { showRemoved: !settings.showRemoved })}
                >
                  {settings.showRemoved ? "Shown" : "Hidden"}
                </Button>
              </div>

              <div className="flex flex-col gap-1">
                <Label>Issues tile</Label>
                <Button
                  size="sm"
                  variant={settings.showIssues ? "default" : "outline"}
                  onClick={() => onSave(scope, { showIssues: !settings.showIssues })}
                >
                  {settings.showIssues ? "Shown" : "Hidden"}
                </Button>
              </div>

              <div className="flex flex-col gap-1">
                <Label>GitHub token</Label>
                <Button
                  size="sm"
                  variant={token?.configured ? "outline" : "default"}
                  onClick={() => setTokenOpen(true)}
                  title="Set the token used for scanning and for listing organization members"
                >
                  <KeyRound />
                  {token?.configured ? `Set${token.hint ? ` (${token.hint})` : ""}` : "Not set"}
                </Button>
              </div>

              <div className="flex flex-col gap-1">
                <Label>Schedule</Label>
                <Button
                  size="sm"
                  variant={schedule?.enabled ? "outline" : "default"}
                  onClick={() => setScheduleOpen(true)}
                  title="Run scans automatically on a recurring schedule"
                >
                  <CalendarClock />
                  {schedule?.enabled ? (schedule.summary ?? "On") : "Off"}
                </Button>
              </div>
            </div>
          </section>
        </div>
      )}

      <FetchUsersDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        alreadyTracked={trackedHandles}
        onAdd={(people) => {
          setAddOpen(false);
          onAddUsers(people);
        }}
        onConfigureToken={() => {
          setAddOpen(false);
          setTokenOpen(true);
        }}
      />

      <GitHubTokenDialog open={tokenOpen} onOpenChange={setTokenOpen} />

      {/* Keyed on the stored timestamp so a schedule changed elsewhere
          remounts the form with fresh values instead of quietly diverging. */}
      {schedule && (
        <ScheduleDialog
          key={schedule.updatedAt ?? "new"}
          open={scheduleOpen}
          onOpenChange={setScheduleOpen}
          state={schedule}
        />
      )}
    </div>
  );
}
