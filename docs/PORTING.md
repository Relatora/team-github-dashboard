# Porting notes

This repository consolidates the GitHub dashboard that previously spanned three
codebases. Written for whoever has to reconcile this against the originals, or
maintain them side by side during a transition.

## What it replaced

| Source | Stack | Role |
|---|---|---|
| `ap_sw_github_work_report_generator` | Python, FastAPI on :8910 | Scanned GitHub, wrote MongoDB, built Markdown reports |
| `web-apps/ts/ts-server` | Express, Mongoose, :8900 | `$facet` aggregations, proxy to the Python service |
| `web-apps/ts/ts-client` | React, Vite, Telerik Kendo, :9009 | The `/github` page |

Three runtimes, three restart procedures, and a paid Kendo licence. A controller
edit on tier two silently kept serving old code because the dev watcher pointed
at the wrong path, so "the toggle does nothing" was usually a stale process
rather than a bug.

## Where each piece went

| Now | Was |
|---|---|
| `lib/github/client.ts` | `GitHubClient`, `RateLimitBudgetError`, `preflight_rate_limit` |
| `lib/github/categorize.ts` | `categorize_commit` and `COMMIT_CATEGORIES` |
| `lib/github/stats.ts` | `commit_stats`, `_path_is_ignored`, `DEFAULT_STAT_IGNORE_GLOBS`, `STATS_VERSION` |
| `lib/github/discovery.ts` | `resolve_scan_repos`, `list_branches`, `build_repo_branch_map`, `filter_scan_branches` |
| `lib/github/scan.ts` | `scan_commits`, `commit_identities`, `normalize_commit_item` |
| `lib/github/enrich.ts` | `enrich_commits_with_stats`, `enrich_mongo_commits` |
| `lib/github/org.ts` | `resolve_org_members` |
| `lib/jobs/store.ts` | the `_jobs` dictionary in `api.py` |
| `lib/db/repositories/` | `save_to_mongodb`, `_upsert_items`, `_commit_mongo_doc` |
| `lib/metrics/aggregate.ts` | the `$facet` pipeline in `GitHubController.js`, `getUsers` |
| `lib/report/` | `build_report_from_mongo`, `write_markdown_report` |
| `lib/settings/` | `AppSettingsController.js` plus `resolveDevSettings` from the client |
| `components/github/dashboard.tsx` | `GitHub.jsx` |
| `components/charts/` | `Charts.jsx` |

## Verified against the original

Two pieces are checked byte-for-byte rather than assumed, because both are
hand-written translations of intricate logic that would look correct while being
subtly wrong:

```bash
npx tsx scripts/verify-categorize.ts <baseline.json>     # 4,936 real messages, 0 mismatches
npx tsx scripts/verify-ignore-globs.ts <baseline.json>   # 33 paths, 0 mismatches
```

The categorizer reproduces the Python distribution exactly across all eight
buckets on real scanned data, including the two messages that land in "Other
changes". Generate a baseline by running `categorize_commit` over
`commits_authored.csv`.

## Deliberately dropped

- **Telerik Kendo.** Replaced by Recharts, react-grid-layout, and local
  shadcn/ui primitives.
- **The ticketing system's roles.** `TsDashBoardViewer`, `TsDeveloper`, and
  `SuperUser` resolved role codes out of that system's own database. They are
  now `viewer`, `developer`, `admin`, defined locally.
- **`ap_sw_nexis_shared`, Redux, axios.**
- **Commit search as a collection mode.** It only indexes default branches. It
  was already not the default, and keeping it as an option would let someone
  turn on a mode that silently under-reports.
- **The Copilot leadership summary text**, which was guidance to paste the
  report elsewhere rather than a feature.
- **CSV and JSON report output.** The database is the store now; Markdown and
  PDF are the shareable formats.
- **The `--cache-mode ask` interactive prompt.** A server cannot answer a prompt.
  Cache behaviour is a parameter.

## Traps carried over

These cost real time in the original and are all still live. They are documented
in place as well; collected here so a reader meets them once.

1. **A stale `GITHUB_TOKEN` in the OS environment silently wins** over one set
   in a file, so changing the token appears to do nothing. Environment changes
   also only reach newly opened terminals.

2. **`/orgs/{org}/members` returns an empty `200`**, not an error, when the token
   cannot see concealed membership. An empty picker is a permission problem. The
   API surfaces this as a warning in the response body rather than only in the
   log, so the interface can say so.

3. **A fixed `end_date` drifts into the past** and a scan never looks beyond it,
   so recently pushed work stops appearing with nothing to indicate why. Hence
   `"today"` as the default, resolved at call time rather than at load time.

4. **A re-scan must not overwrite enriched statistics.** In Python this depended
   on remembering to omit fields from the update document. Now it is `COALESCE`
   in the upsert. See ARCHITECTURE.md.

5. **Merge commits double count.** They re-show the entire diff they merged.
   Zero in cleaned, full in raw.

6. **Issue authors were not captured historically**, so old rows have an empty
   login. They are skipped rather than attributed to everyone, which is what
   would otherwise happen. Filling them in needs a re-scan, not an enrich run:
   enrichment only touches commit statistics.

7. **Charts squash if you let the library draw the legend.** Kendo's legend
   stole horizontal width from the donut; Recharts' `<Legend>` does the same.
   The custom legend is not a leftover.

8. **Canvas capture cannot see `position: fixed`**, and a hidden element has no
   layout so its charts render at zero height. The print document is positioned
   absolute and moved off screen. Kendo's `drawDOM` had the identical
   limitation.

9. **`html2canvas` throws on `oklch()`**, which Tailwind v4 emits.
   `html2canvas-pro` is the fork that handles it.

10. **A saved layout keyed by array position breaks** whenever a tile is added or
    removed. Layouts are keyed by tile id now, so an unknown tile is dropped and
    a new one is appended from the default rather than the whole arrangement
    being discarded.

## Running both during a transition

They can coexist. The Python tool writes MongoDB and this writes Postgres, so
neither sees the other's data and neither corrupts it. `npm run import-mongo`
copies MongoDB across whenever you want to catch up; it is idempotent, so
running it repeatedly is safe.

The only shared resource is the GitHub API quota. Two scanners against one token
will exhaust it faster than either expects, so stagger any schedules.
