/**
 * The one data-fetching shape every Insights tab uses: request tagged by a key, state set
 * only inside `.then`/`.catch` — never synchronously in the effect body, which is what
 * deadlocks under React 19 StrictMode's dev-mode double-invoke (see DispatchPanel.tsx for
 * the pattern this follows).
 */

import { useEffect, useState } from 'react';

interface Loaded<T> { request: string; data: T | null; error: string | null }

export function useInsight<T>(key: string, fetcher: () => Promise<T>): {
  data: T | null; error: string | null; loading: boolean; stale: boolean;
} {
  const [state, setState] = useState<Loaded<T>>({ request: '', data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    fetcher()
      .then((data) => { if (!cancelled) setState({ request: key, data, error: null }); })
      .catch((err: { message?: string }) => { if (!cancelled) setState({ request: key, data: null, error: err.message ?? 'Failed to load' }); });
    return () => { cancelled = true; };
    // `fetcher` is a fresh closure every render; `key` is the caller's own summary of
    // everything that closure depends on, which is what actually decides whether to refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const fresh = state.request === key;
  return {
    // The LAST result, fresh or not. A filter change must not blank the page: the
    // previous numbers stay on screen, dimmed, until the new ones land.
    data: state.data,
    error: fresh ? state.error : null,
    /** No data at all yet — the only case that deserves a skeleton. */
    loading: !fresh && state.data == null,
    /** Showing the previous answer while the new one is in flight. */
    stale: !fresh && state.data != null,
  };
}
