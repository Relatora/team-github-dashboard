"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Counts up from 0 to `value` on mount, then holds.
 *
 * Initial state is `value` itself, not 0 - the server-rendered markup and the
 * first client render must match exactly, or React reports a hydration
 * error. The count-up is a deliberate state change inside useEffect, which
 * runs strictly after hydration, so React never compares a mismatched pair
 * of trees; it just sees the number change, the same as any other update.
 *
 * prefers-reduced-motion skips the animation and shows the final number
 * immediately, matching the CSS entrance animations elsewhere on this page.
 */
export function AnimatedCounter({
  value,
  prefix = "",
  suffix = "",
  durationMs = 1400,
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  durationMs?: number;
}) {
  const [display, setDisplay] = useState(value);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    // Initial state is already `value` (see the useState call above), so the
    // reduced-motion case needs no update at all - just skip the animation.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    // No explicit reset to 0 here: the first requestAnimationFrame callback
    // computes t=0 -> easeOutExpo(0)=0 on its own, so the count-up starts at
    // zero without a synchronous setState call in the effect body itself
    // (react-hooks/set-state-in-effect wants updates driven from the
    // animation's own callback, not the effect that merely starts it).
    let raf = 0;
    const start = performance.now();
    const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      setDisplay(Math.round(value * easeOutExpo(t)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);

  return (
    <span suppressHydrationWarning>
      {prefix}
      {display.toLocaleString("en-US")}
      {suffix}
    </span>
  );
}
