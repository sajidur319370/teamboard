import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * UI-only preferences (never server data: that lives in TanStack Query).
 * Persisted per browser as a convenience; if storage is blocked it just isn't remembered.
 */
interface UiState {
  compactCards: boolean;
  toggleCompact: () => void;
}

const safeStorage = createJSONStorage(() => {
  try {
    return localStorage;
  } catch {
    return {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    };
  }
});

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      compactCards: false,
      toggleCompact: () => set((s) => ({ compactCards: !s.compactCards })),
    }),
    { name: 'teamboard-ui', storage: safeStorage },
  ),
);
