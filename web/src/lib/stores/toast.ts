/**
 * Transient messages — a dispatch confirmed, a 409 explained, a server `notify`.
 * Errors stay until dismissed; everything else leaves on its own.
 */

import { createStore, useStore } from './createStore';

export interface Toast {
  id: number;
  level: 'info' | 'success' | 'warning' | 'danger';
  title: string;
  body?: string;
  action?: { label: string; run: () => void };
}

export const toastStore = createStore<{ toasts: Toast[] }>({ toasts: [] });

let seq = 0;

export function toast(t: Omit<Toast, 'id'>): number {
  const id = ++seq;
  toastStore.update((s) => ({ toasts: [...s.toasts.slice(-4), { ...t, id }] }));
  if (t.level !== 'danger') setTimeout(() => dismissToast(id), t.level === 'warning' ? 9000 : 5000);
  return id;
}

export function dismissToast(id: number): void {
  toastStore.update((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

export const useToasts = () => useStore(toastStore, (s) => s.toasts);
