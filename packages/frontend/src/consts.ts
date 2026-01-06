// Stable empty references to prevent infinite re-renders in React/Zustand
// Use these instead of inline [] or {} in selectors and default values

export const EMPTY_ARRAY: readonly never[] = [];
export const EMPTY_OBJ: Readonly<Record<string, never>> = {};
