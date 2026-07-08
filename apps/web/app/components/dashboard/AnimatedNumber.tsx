"use client";

import { memo, useEffect, useRef, useState } from "react";

/** Lightweight requestAnimationFrame counter — framer-motion isn't a dependency of this app
 *  (checked package.json), so this rolls the same "count up to value" effect without adding one. */
function useAnimatedNumber(value: number, durationMs = 700): number {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (from === to) return;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, durationMs]);

  return display;
}

export const AnimatedNumber = memo(function AnimatedNumber({
  value,
  format,
  durationMs,
}: {
  value: number;
  format?: (n: number) => string;
  durationMs?: number;
}) {
  const display = useAnimatedNumber(value, durationMs);
  return <>{format ? format(display) : Math.round(display).toLocaleString()}</>;
});
