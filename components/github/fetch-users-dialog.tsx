"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { getOrgMembers } from "@/lib/api/github";
import { cn } from "@/lib/utils";

/**
 * Pick organization members and add them to the tracked roster.
 *
 * Adding is NOT scanning. They appear in the Users and Shown users controls
 * immediately, with a zero count and a never-scanned badge, and scanning is a
 * separate deliberate act. Starting an hour-long scan on a misclick in a list
 * of thirty names is the behaviour this replaced.
 */
export function FetchUsersDialog({
  open,
  onOpenChange,
  onAdd,
  onConfigureToken,
  alreadyTracked = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (people: Array<{ handle: string; avatarUrl?: string }>) => void;
  /** Handles already on the roster, so the list can say so instead of offering them twice. */
  alreadyTracked?: string[];
  /** Jump straight to the token dialog when that is what is missing. */
  onConfigureToken?: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["orgMembers"],
    queryFn: getOrgMembers,
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const members = (data?.members ?? []).filter((m) =>
    m.login.toLowerCase().includes(query.trim().toLowerCase())
  );
  const trackedSet = new Set(alreadyTracked.map((h) => h.toLowerCase()));

  const toggle = (login: string) =>
    setSelected((current) =>
      current.includes(login) ? current.filter((l) => l !== login) : [...current, login]
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Add organization members</DialogTitle>
        <DialogDescription>
          Adds these people to the roster so they can be selected straight away. This does not
          scan them; use Scan tracked people when you are ready to spend the API quota.
        </DialogDescription>

        {/* GitHub returns an empty success rather than an error when the token
            cannot see concealed membership, so an empty list needs explaining
            or it reads as a bug. */}
        {data?.warnings?.map((warning) => {
          const aboutToken = warning.includes("token");
          return (
            <div
              key={warning}
              className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <div className="flex flex-col items-start gap-1.5">
                <span>{warning}</span>
                {aboutToken && onConfigureToken && (
                  <Button size="sm" variant="outline" onClick={onConfigureToken}>
                    Set a token
                  </Button>
                )}
              </div>
            </div>
          );
        })}

        {error && (
          <p className="text-sm text-destructive">Could not reach GitHub to list members.</p>
        )}

        <Input placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />

        <div className="min-h-32 flex-1 overflow-y-auto rounded-md border border-border">
          {isLoading && (
            <div className="flex items-center justify-center p-6 text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />
              Loading members
            </div>
          )}
          {!isLoading && !members.length && (
            <p className="p-6 text-center text-sm text-muted-foreground">No members to show.</p>
          )}
          <ul className="p-1">
            {members.map((member) => {
              const tracked = trackedSet.has(member.login.toLowerCase());
              return (
                <li key={member.login}>
                  <button
                    type="button"
                    onClick={() => toggle(member.login)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
                      selected.includes(member.login) && "bg-accent font-medium"
                    )}
                  >
                    <span className="truncate">{member.login}</span>
                    {tracked && (
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        on the roster
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!selected.length}
            onClick={() =>
              onAdd(
                selected.map((login) => ({
                  handle: login,
                  avatarUrl: members.find((m) => m.login === login)?.avatar_url,
                }))
              )
            }
          >
            Add {selected.length || ""} {selected.length === 1 ? "person" : "people"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
