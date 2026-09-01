"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  clearGitHubToken,
  getGitHubTokenStatus,
  setGitHubToken,
  type TokenStatus,
} from "@/lib/api/github";

/**
 * Set, replace, or remove the GitHub token.
 *
 * The token is only ever sent to the server; nothing here ever receives it
 * back. What comes back is the state: whether one is set, where it came from,
 * a four character hint, and the account it validated as.
 */
export function GitHubTokenDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { data: status, isLoading } = useQuery({
    queryKey: ["githubToken"],
    queryFn: getGitHubTokenStatus,
    enabled: open,
  });

  const invalidate = () => {
    setToken("");
    queryClient.invalidateQueries({ queryKey: ["githubToken"] });
    // The member picker and any scan depend on the token, so their cached
    // failures are now stale.
    queryClient.invalidateQueries({ queryKey: ["orgMembers"] });
  };

  const save = useMutation({
    mutationFn: (input: { mode: "token"; token: string } | { mode: "gh-cli" }) =>
      setGitHubToken(input),
    onMutate: () => {
      setError(null);
      setSuccess(null);
    },
    onSuccess: (result) => {
      invalidate();
      // Keep the dialog open on success. When it was opened by the first-use
      // prompt, its visibility is derived from "no token configured", so saving
      // one would otherwise make it vanish before the confirmation is read.
      onOpenChange(true);
      setSuccess(
        result.validated?.login
          ? `Saved. GitHub accepted it as ${result.validated.login}, with ` +
            `${result.validated.coreRemaining?.toLocaleString("en-US")} of ` +
            `${result.validated.coreLimit?.toLocaleString("en-US")} requests left this hour.`
          : "Saved."
      );
    },
    onError: (e: Error) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: clearGitHubToken,
    onSuccess: () => {
      invalidate();
      setSuccess("Removed.");
    },
    onError: (e: Error) => setError(e.message),
  });

  const busy = save.isPending || remove.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>GitHub token</DialogTitle>
        <DialogDescription>
          Needed to scan GitHub and to list organization members. Reading a dashboard that already
          has data does not need one.
        </DialogDescription>

        {isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Checking
          </div>
        ) : (
          <>
            <TokenState status={status} />

            {error && (
              <p className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {error}
              </p>
            )}

            {success && (
              <p className="flex gap-2 rounded-md border border-emerald-600/40 bg-emerald-600/10 p-2 text-xs text-emerald-500">
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
                {success}
              </p>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="gh-token">
                {status?.configured ? "Replace with a new token" : "Paste a token"}
              </Label>
              <Input
                id="gh-token"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="ghp_... or github_pat_..."
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && token.trim() && !busy) {
                    save.mutate({ mode: "token", token: token.trim() });
                  }
                }}
              />
              <p className="text-xs text-muted-foreground">
                A classic token needs <code className="text-[11px]">repo</code> and{" "}
                <code className="text-[11px]">read:org</code>. A fine-grained token needs Contents
                and Metadata read plus Organization Members read, and its resource owner must be the
                organization itself.{" "}
                <a
                  href="https://github.com/settings/tokens"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-0.5 text-primary underline"
                >
                  Create one
                  <ExternalLink className="size-3" />
                </a>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                disabled={!token.trim() || busy}
                onClick={() => save.mutate({ mode: "token", token: token.trim() })}
              >
                {save.isPending && <Loader2 className="animate-spin" />}
                Validate and save
              </Button>

              {/* Only offered when gh is actually installed and signed in on the
                  host running this server, which in practice means development. */}
              {status?.ghCliAvailable && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => save.mutate({ mode: "gh-cli" })}
                  title="Read the token the gh CLI is already holding on this machine"
                >
                  <Terminal />
                  Use the gh CLI token
                </Button>
              )}

              {status?.source === "stored" && (
                <Button
                  variant="ghost"
                  className="text-destructive"
                  disabled={busy}
                  onClick={() => remove.mutate()}
                >
                  Remove
                </Button>
              )}

              <Button variant="ghost" className="ml-auto" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TokenState({ status }: { status?: TokenStatus }) {
  if (!status) return null;

  if (!status.configured) {
    return (
      <p className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
        No token is set, so Fetch users and Refresh data will not work yet.
      </p>
    );
  }

  return (
    <div className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
      <div>
        Currently using the{" "}
        <strong className="text-foreground">
          {status.source === "stored" ? "token saved here" : "GITHUB_TOKEN environment variable"}
        </strong>
        {status.hint && <> ending {status.hint}</>}
        {status.label && <>, as {status.label}</>}.
      </div>
      {status.source === "environment" && (
        // Saying this up front prevents the confusion the source tool caused,
        // where it was never clear which token was actually in use.
        <div className="mt-1">Saving one here will take priority over it.</div>
      )}
      {status.source === "stored" && status.updatedBy && (
        <div className="mt-1">Set by {status.updatedBy}.</div>
      )}
    </div>
  );
}
