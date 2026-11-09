import { useEffect, useRef, useState } from "react";

/**
 * The height of an element as it is laid out, so a chart can fill what its card was
 * given. Starts at `min` and never goes below it, so a short window cannot squash the
 * chart to nothing.
 */
export function useElementHeight<T extends HTMLElement>(min: number) {
  const ref = useRef<T | null>(null);
  const [height, setHeight] = useState(min);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeight(Math.max(min, Math.floor(entry.contentRect.height)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [min]);

  return { ref, height };
}
