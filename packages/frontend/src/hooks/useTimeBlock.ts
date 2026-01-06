import { create } from 'zustand';

export interface TimingEntry {
  id: string;
  name: string;
  duration: number;
  timestamp: number;
}

export interface TimingStats {
  count: number;
  total: number;
  avg: number;
  max: number;
  min: number;
  lastDuration: number;
}

interface DebugStore {
  enabled: boolean;
  stats: Record<string, TimingStats>;
  recentEntries: TimingEntry[];
  maxRecentEntries: number;
  recordTiming: (name: string, duration: number) => void;
  clearStats: () => void;
  setEnabled: (enabled: boolean) => void;
  toggleEnabled: () => void;
}

// Global debug store for collecting timing data
export const useDebugStore = create<DebugStore>((set, get) => ({
  enabled: true,
  stats: {},
  recentEntries: [],
  maxRecentEntries: 50,

  recordTiming: (name, duration) => {
    if (!get().enabled) return;

    set((state) => {
      // Update stats
      const existingStats = state.stats[name] || {
        count: 0,
        total: 0,
        avg: 0,
        max: 0,
        min: Infinity,
        lastDuration: 0,
      };

      const newStats: TimingStats = {
        count: existingStats.count + 1,
        total: existingStats.total + duration,
        avg: (existingStats.total + duration) / (existingStats.count + 1),
        max: Math.max(existingStats.max, duration),
        min: Math.min(existingStats.min, duration),
        lastDuration: duration,
      };

      // Add recent entry
      const entry: TimingEntry = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name,
        duration,
        timestamp: Date.now(),
      };

      const newRecentEntries = [...state.recentEntries, entry];
      if (newRecentEntries.length > state.maxRecentEntries) {
        newRecentEntries.shift();
      }

      return {
        stats: { ...state.stats, [name]: newStats },
        recentEntries: newRecentEntries,
      };
    });
  },

  clearStats: () => set({ stats: {}, recentEntries: [] }),

  setEnabled: (enabled) => set({ enabled }),

  toggleEnabled: () => set((state) => ({ enabled: !state.enabled })),
}));

/**
 * Time a synchronous function execution.
 * Can be used conditionally - not a hook!
 *
 * @param name - Identifier for this timing block
 * @param fn - Function to execute and time
 * @returns The result of the function
 */
export function timeBlock<T>(name: string, fn: () => T): T {
  const store = useDebugStore.getState();

  if (!store.enabled) {
    return fn();
  }

  const start = performance.now();
  const result = fn();
  const duration = performance.now() - start;

  store.recordTiming(name, duration);

  if (duration > 16) {
    // More than one frame (60fps)
    console.warn(`[timeBlock] ${name} took ${duration.toFixed(2)}ms (slow)`);
  }

  return result;
}

/**
 * Time an async function execution.
 * Can be used conditionally - not a hook!
 *
 * @param name - Identifier for this timing block
 * @param fn - Async function to execute and time
 * @returns The result of the async function
 */
export async function timeBlockAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const store = useDebugStore.getState();

  if (!store.enabled) {
    return fn();
  }

  const start = performance.now();
  const result = await fn();
  const duration = performance.now() - start;

  store.recordTiming(name, duration);

  return result;
}

/**
 * Create a timed wrapper for a function.
 * Useful for timing callbacks.
 *
 * @param name - Identifier for this timing block
 * @param fn - Function to wrap
 * @returns Wrapped function that records timing
 */
export function timedFn<T extends (...args: unknown[]) => unknown>(
  name: string,
  fn: T
): T {
  return ((...args: Parameters<T>) => {
    return timeBlock(name, () => fn(...args));
  }) as T;
}

/**
 * Decorator-style timing for class methods (manual usage).
 * Usage: const result = timed('methodName', () => this.method());
 */
export const timed = timeBlock;

/**
 * Get sorted stats by total time (descending)
 */
export function getTopTimings(limit = 10): Array<{ name: string; stats: TimingStats }> {
  const { stats } = useDebugStore.getState();

  return Object.entries(stats)
    .map(([name, s]) => ({ name, stats: s }))
    .sort((a, b) => b.stats.total - a.stats.total)
    .slice(0, limit);
}

/**
 * Get sorted stats by average time (descending)
 */
export function getSlowestAverage(limit = 10): Array<{ name: string; stats: TimingStats }> {
  const { stats } = useDebugStore.getState();

  return Object.entries(stats)
    .map(([name, s]) => ({ name, stats: s }))
    .sort((a, b) => b.stats.avg - a.stats.avg)
    .slice(0, limit);
}
