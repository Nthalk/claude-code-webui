import { useRef, useEffect } from 'react';

interface ChangedResult {
  changed: string[];
  previous: Record<string, unknown>;
  current: Record<string, unknown>;
}

/**
 * Hook to track what properties changed between renders.
 * Useful for debugging unnecessary re-renders.
 *
 * @param name - Identifier for this component/hook in logs
 * @param props - Object with properties to track
 * @param keys - Optional array of keys to track (defaults to all keys)
 * @returns Object with changed keys and their previous/current values
 */
export function useChanged<T extends Record<string, unknown>>(
  name: string,
  props: T,
  keys?: (keyof T)[]
): ChangedResult {
  const previousRef = useRef<T | null>(null);
  const keysToTrack = keys || (Object.keys(props) as (keyof T)[]);

  const changed: string[] = [];
  const previous: Record<string, unknown> = {};
  const current: Record<string, unknown> = {};

  if (previousRef.current !== null) {
    for (const key of keysToTrack) {
      const prevValue = previousRef.current[key];
      const currValue = props[key];

      if (!Object.is(prevValue, currValue)) {
        changed.push(String(key));
        previous[String(key)] = prevValue;
        current[String(key)] = currValue;
      }
    }

    if (changed.length > 0) {
      console.log(`[useChanged] ${name}:`, {
        changed,
        previous,
        current,
      });
    }
  }

  useEffect(() => {
    previousRef.current = { ...props };
  });

  return { changed, previous, current };
}

/**
 * Hook to track why a component re-rendered.
 * Logs which props changed on each render.
 *
 * @param name - Component name for logging
 * @param props - All props to track
 */
export function useWhyDidYouRender<T extends Record<string, unknown>>(
  name: string,
  props: T
): void {
  useChanged(name, props);
}
