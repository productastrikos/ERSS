/**
 * The session token for THIS browser tab.
 *
 * Held in sessionStorage, not a cookie: a cookie is shared by every tab on the origin, so
 * signing in as a responder in one tab would silently sign the dispatcher out of another.
 * Per-tab tokens let a dispatcher console, a responder phone and a citizen phone run side
 * by side in one browser — which is exactly how this product is demonstrated and tested.
 * A reload keeps the tab signed in; a new tab starts signed out.
 */

const KEY = 'erss.session.v1';
let memory: string | null = null;

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(KEY) ?? memory;
  } catch {
    return memory;
  }
}

export function setToken(token: string | null): void {
  memory = token;
  try {
    if (token) sessionStorage.setItem(KEY, token);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage blocked — the in-memory copy still works for this page */
  }
}
