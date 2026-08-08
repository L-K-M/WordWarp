import { describe, expect, it } from 'vitest';

import { exportErrorMessage } from './errors';

describe('export error messages', () => {
  // Verbatim from each engine. All three name an internal detail and none say what to do.
  const chunkFailures = [
    'error loading dynamically imported module: http://localhost:5173/node_modules/.vite/deps/fast-png.js?v=d1aa8252',
    'Failed to fetch dynamically imported module: https://example.com/assets/index-BdqAUEOp.js',
    'Importing a module script failed.',
  ];

  it.each(chunkFailures)('asks for a reload when a chunk cannot be fetched: %s', (message) => {
    expect(exportErrorMessage(new Error(message))).toMatch(/Reload the page/);
  });

  it('passes real export failures through untouched', () => {
    // These are the messages the export path raises on purpose, and they are already actionable.
    const overBudget = 'Animated export at 3552 x 1352 needs 1024 MB of frame memory, over the'
      + ' 256 MB budget. Lower the export resolution or shorten the loop.';
    expect(exportErrorMessage(new Error(overBudget))).toBe(overBudget);
    expect(exportErrorMessage(new Error('PNG pixel buffer has an invalid length')))
      .toBe('PNG pixel buffer has an invalid length');
  });

  it('falls back for values that are not errors', () => {
    expect(exportErrorMessage('boom')).toBe('Export failed');
    expect(exportErrorMessage(undefined)).toBe('Export failed');
  });
});
