"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, KeyRound, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/ui/multi-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FetchUsersDialog } from "./fetch-users-dialog";
import { GitHubTokenDialog } from "./github-token-dialog";
import { getGitHubTokenStatus } from "@/lib/api/github";
import type { ResolvedDevSettings } from "@/lib/settings/types";
import type { RosterUser } from "@/lib/api/github";

/**
 * Developer-only settings.
 *
 * Ported from the developer section of ControlCenter.jsx. Collapsed by default,
 * because these controls change what everyone else sees and should not be one
 * stray click away.
 */
export function DeveloperPanel({
  settings,
  roster,
  onSave,
  onFetchUsers,
  isScanning,
}: {
  settings: ResolvedDevSettings;
  roster: RosterUser[];
  onSave: (scope: "me" | "everyone", patch: Partial<ResolvedDevSettings>) => void;
  onFetchUsers: (logins: string[]) => void;
  isScanning: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<"me" | "everyone">("me");
  const [fetchOpen, setFetchOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);

  const { data: token } = useQuery({ queryKey: ["githubToken"], queryFn: getGitHubTokenStatus });

  const sourceLabel =
    settings.source === "user"
      ? "your override"
      : settings.source === "global"
        ? "everyone default"
        : "default";

  return (
    <div className="mb-4 rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium"
      >
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        Developer settings
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          {settings.calcMode} counting, removed {settings.showRemoved ? "shown" : "hidden"} ({sourceLabel})
        </span>
        {token && !token.configured && (
          <span className="ml-auto rounded-full border border-amber-500/40 px-2 py-0.5 text-xs font-normal text-amber-500">
            No GitHub token
          </span>
        )}
      </button>

      {open && (
        <div className="flex flex-wrap items-end gap-4 border-t border-border p-3">
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

          <div className="flex min-w-72 flex-1 flex-col gap-1">
            <Label>Shown users</Label>
            <MultiSelect
              options={roster.map((u) => ({ value: u.handle, label: u.name }))}
              value={settings.shownUsers}
              onChange={(shownUsers) => onSave(scope, { shownUsers })}
              placeholder="Everyone in the data"
            />
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
              {token?.configured
                ? `Set${token.hint ? ` (${token.hint})` : ""}`
                : "Not set"}
            </Button>
          </div>

          <div className="flex flex-col gap-1">
            <Label>Data</Label>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setFetchOpen(true)}
              disabled={isScanning}
              title="Scan GitHub for organization members not yet in the data"
            >
              <Users />
              Fetch users
            </Button>
          </div>
        </div>
      )}

      <FetchUsersDialog
        open={fetchOpen}
        onOpenChange={setFetchOpen}
        onFetch={(logins) => {
          setFetchOpen(false);
          onFetchUsers(logins);
        }}
        onConfigureToken={() => {
          setFetchOpen(false);
          setTokenOpen(true);
        }}
      />

      <GitHubTokenDialog open={tokenOpen} onOpenChange={setTokenOpen} />
    </div>
  );
}
