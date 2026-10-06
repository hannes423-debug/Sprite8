import type { getState } from '../app/store';

declare global {
  interface Window {
    /** Read-only hook for debugging and automated tests: window.sprite8.getState(). */
    sprite8?: { version: string; getState: typeof getState };
  }
}

export {};
