/**
 * Browser wording for a lazily loaded chunk that could not be fetched.
 *
 * Chrome and Firefox each phrase it differently, and Safari drops the URL entirely.
 */
const CHUNK_LOAD_FAILURE = /dynamically imported module|Importing a module script failed|error loading dynamically/i;

/**
 * Turns an export failure into something a person can act on.
 *
 * The encoders are kept out of the initial bundle and fetched on first use, which makes them the
 * one part of an export that can fail on its own. They fail when the page is running against a
 * build whose chunks are gone -- a tab left open across a deploy, which this app invites by
 * precaching through a service worker, or a dev server that re-optimised its dependencies and
 * moved the URL. Because the fetch only happens on the button press, the page itself loaded fine
 * and the failure lands after the user has already waited for a render.
 *
 * Left alone, what reaches the toast is the loader's own text -- "error loading dynamically
 * imported module: http://localhost:5173/node_modules/.vite/deps/fast-png.js?v=d1aa8252" -- which
 * names an internal path, no cause, and no way forward. Reloading genuinely fixes it, so say so.
 *
 * This deliberately lives away from the import itself: wrapping the dynamic import in a `try` or a
 * `.catch()` stops Rollup seeing which bindings are destructured off it, and it then keeps every
 * export. For fast-png that drags the whole decoder -- inflate, CRC checks, APNG frame handling --
 * into a chunk that only ever encodes, measured at +30 kB raw across the lazy chunks.
 */
export function exportErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Export failed';
  if (CHUNK_LOAD_FAILURE.test(error.message)) {
    return 'Could not load the exporter. Reload the page and try exporting again.';
  }
  return error.message;
}
