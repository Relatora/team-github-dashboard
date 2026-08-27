"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { Loader2 } from "lucide-react";
import { HttpError } from "@/lib/api/github";

/**
 * The narrative report tile.
 *
 * The source shipped a hand-written Markdown to HTML converter that was
 * XSS-safe by hand. This uses react-markdown with rehype-sanitize instead: the
 * sanitization is audited rather than hand-rolled, and GitHub flavoured tables
 * come for free, which the report leans on heavily.
 *
 * Sanitizing matters even though we generate the Markdown ourselves, because
 * commit messages go into it verbatim and anyone with push access writes those.
 */
export function ReportView({
  markdown,
  isLoading,
  error,
}: {
  markdown?: string;
  isLoading: boolean;
  error: unknown;
}) {
  if (isLoading && !markdown) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        Building the report
      </div>
    );
  }

  if (error) {
    const status = error instanceof HttpError ? error.status : 0;
    // These need different messages because they need different actions from
    // whoever is reading. "Nobody has scanned this yet" is not a failure.
    const message =
      status === 409
        ? "No stored data for these users or period yet. Click Refresh data to run a scan."
        : status === 401 || status === 403
          ? "You do not have access to this report."
          : "Could not build the work report.";

    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        {message}
      </div>
    );
  }

  return (
    <div className="report-prose text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {markdown ?? ""}
      </ReactMarkdown>
    </div>
  );
}
