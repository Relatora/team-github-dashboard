"use client";

/**
 * A timestamp formatted in the viewer's locale and timezone.
 *
 * Locale formatting is a classic hydration mismatch: the server formats with
 * Node's ICU data and the server's timezone, the browser formats with its own,
 * and React then reports a hydration failure on a difference that is entirely
 * intentional.
 *
 * suppressHydrationWarning is the intended tool for exactly this case. The
 * server renders an ISO date, which is unambiguous if a page is ever read
 * without JavaScript, and the client replaces it with the local format.
 */
export function LocalTime({ value, dateOnly = false }: { value: string | Date; dateOnly?: boolean }) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const iso = date.toISOString();
  const text =
    typeof window === "undefined"
      ? iso.slice(0, dateOnly ? 10 : 16).replace("T", " ")
      : dateOnly
        ? date.toLocaleDateString()
        : date.toLocaleString();

  return (
    <time dateTime={iso} suppressHydrationWarning>
      {text}
    </time>
  );
}
