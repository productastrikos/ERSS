/**
 * The ONE state idiom in this codebase.
 *
 * A module-level store plus useSyncExternalStore. No Redux, no Zustand, no React Query.
 * The DSO App.tsx held 25+ pieces of state and drilled every one of them into children;
 * this is what replaces that.
 *
 *   const counter = createStore({ n: 0 });
 *   counter.set({ n: 1 });                  // replace fields
 *   counter.update(s => ({ n: s.n + 1 }));  // derive from current
 *   const { n } = useStore(counter);        // subscribe in a component
 *   const n     = useStore(counter, s => s.n);  // subscribe to a slice
 */

import { useSyncExternalStore, useRef, useCallback } from 'react';

export interface Store<T> {
  get(): T;
  set(partial: Partial<T>): void;
  update(fn: (current: T) => Partial<T>): void;
  reset(): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  const snapshot = { ...initial };

  const emit = () => { for (const l of listeners) l(); };

  return {
    get: () => state,
    set(partial) {
      // Skip the notify when nothing actually changed — a store that re-renders on
      // every socket frame regardless of content is how a live map starts dropping
      // frames.
      let changed = false;
      for (const k of Object.keys(partial) as Array<keyof T>) {
        if (!Object.is(state[k], partial[k])) { changed = true; break; }
      }
      if (!changed) return;
      state = { ...state, ...partial };
      emit();
    },
    update(fn) { this.set(fn(state)); },
    reset() { state = { ...snapshot } as T; emit(); },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** Subscribe to a whole store, or to a slice of it. */
export function useStore<T extends object>(store: Store<T>): T;
export function useStore<T extends object, S>(store: Store<T>, selector: (s: T) => S): S;
export function useStore<T extends object, S>(store: Store<T>, selector?: (s: T) => S) {
  const lastRef = useRef<S | undefined>(undefined);

  const getSnapshot = useCallback(() => {
    if (!selector) return store.get() as unknown as S;
    const next = selector(store.get());
    // Keep a stable reference for object slices so useSyncExternalStore does not see a
    // new object on every read and loop.
    if (shallowEqual(lastRef.current, next)) return lastRef.current as S;
    lastRef.current = next;
    return next;
  }, [store, selector]);

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.is((a as never)[k], (b as never)[k]));
}
