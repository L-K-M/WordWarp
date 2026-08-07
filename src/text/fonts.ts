import type { WordWarpDocument } from '../model/types';

export type FontTag = 'chunky' | 'funky' | 'neon & pixel' | 'system';

export interface FontCatalogEntry {
  family: string;
  source: 'bundled' | 'local';
  /** Weight stamped into the document's FontSpec when this family is picked. */
  weight: number;
  /** woff2 file inside `src/assets/fonts/`; absent for system fonts. */
  file?: string;
  /** FontFace weight descriptor, e.g. "400 800" for a variable font. */
  weightRange?: string;
  tag: FontTag;
  /** Chrome font for the interface itself, never offered for documents. */
  ui?: boolean;
}

export const FONT_TAG_ORDER: readonly FontTag[] = ['chunky', 'funky', 'neon & pixel', 'system'];

export const FONT_CATALOG: readonly FontCatalogEntry[] = [
  { family: 'Bungee', source: 'bundled', weight: 400, file: 'bungee-400.woff2', tag: 'chunky' },
  { family: 'Titan One', source: 'bundled', weight: 400, file: 'titan-one-400.woff2', tag: 'chunky' },
  { family: 'Modak', source: 'bundled', weight: 400, file: 'modak-400.woff2', tag: 'chunky' },
  { family: 'Chango', source: 'bundled', weight: 400, file: 'chango-400.woff2', tag: 'chunky' },
  { family: 'Luckiest Guy', source: 'bundled', weight: 400, file: 'luckiest-guy-400.woff2', tag: 'chunky' },
  { family: 'Shrikhand', source: 'bundled', weight: 400, file: 'shrikhand-400.woff2', tag: 'funky' },
  { family: 'Ranchers', source: 'bundled', weight: 400, file: 'ranchers-400.woff2', tag: 'funky' },
  { family: 'Slackey', source: 'bundled', weight: 400, file: 'slackey-400.woff2', tag: 'funky' },
  { family: 'Spicy Rice', source: 'bundled', weight: 400, file: 'spicy-rice-400.woff2', tag: 'funky' },
  { family: 'Monoton', source: 'bundled', weight: 400, file: 'monoton-400.woff2', tag: 'neon & pixel' },
  { family: 'Press Start 2P', source: 'bundled', weight: 400, file: 'press-start-2p-400.woff2', tag: 'neon & pixel' },
  { family: 'Black Ops One', source: 'bundled', weight: 400, file: 'black-ops-one-400.woff2', tag: 'chunky' },
  { family: 'Arial Black', source: 'local', weight: 900, tag: 'system' },
  { family: 'Arial', source: 'local', weight: 400, tag: 'system' },
  { family: 'Comic Sans MS', source: 'local', weight: 700, tag: 'system' },
  { family: 'Courier New', source: 'local', weight: 700, tag: 'system' },
  { family: 'Georgia', source: 'local', weight: 400, tag: 'system' },
  { family: 'Impact', source: 'local', weight: 400, tag: 'system' },
  { family: 'Times New Roman', source: 'local', weight: 400, tag: 'system' },
  { family: 'Trebuchet MS', source: 'local', weight: 400, tag: 'system' },
  { family: 'Verdana', source: 'local', weight: 400, tag: 'system' },
  { family: 'sans-serif', source: 'local', weight: 400, tag: 'system' },
  { family: 'serif', source: 'local', weight: 400, tag: 'system' },
  { family: 'monospace', source: 'local', weight: 400, tag: 'system' },
  { family: 'Baloo 2', source: 'bundled', weight: 700, file: 'baloo-2-var.woff2', weightRange: '400 800', tag: 'system', ui: true },
];

export const DOCUMENT_FONTS: readonly FontCatalogEntry[] = FONT_CATALOG.filter((entry) => !entry.ui);

export function getFontCatalogEntry(family: string): FontCatalogEntry | undefined {
  return FONT_CATALOG.find((entry) => entry.family === family);
}

/** Tracks every family that finished loading, so callers can tell a fresh load from a cache hit. */
const ready = new Set<string>();
const pending = new Map<string, Promise<boolean>>();

export function isFontReady(family: string): boolean {
  return ready.has(family);
}

/**
 * Register and load a bundled font face. System fonts and unknown families resolve immediately --
 * the renderer matches those itself. A failed load resolves `false` rather than rejecting, so a
 * missing font file degrades to a fallback face instead of failing an export.
 */
export function ensureFontLoaded(family: string): Promise<boolean> {
  const entry = getFontCatalogEntry(family);
  if (!entry || entry.source !== 'bundled' || !entry.file) return Promise.resolve(true);
  if (ready.has(family)) return Promise.resolve(true);
  let load = pending.get(family);
  if (!load) {
    load = loadBundledFont(entry);
    pending.set(family, load);
  }
  return load;
}

/**
 * Load every bundled font a document uses. Resolves `true` when at least one font became ready
 * during this call -- the signal the preview uses to schedule a re-render with the real face.
 */
export async function ensureFontsForDocument(document: WordWarpDocument): Promise<boolean> {
  const families = new Set<string>();
  for (const element of document.elements) {
    if (element.type === 'text') families.add(element.font.family);
  }
  let loadedSomething = false;
  await Promise.all([...families].map(async (family) => {
    if (!ready.has(family) && await ensureFontLoaded(family)) loadedSomething = true;
  }));
  return loadedSomething;
}

/** Kick the interface chrome font off at boot; it renders with fallbacks until it lands. */
export function ensureUiFonts(): void {
  for (const entry of FONT_CATALOG) {
    if (entry.ui) void ensureFontLoaded(entry.family);
  }
}

async function loadBundledFont(entry: FontCatalogEntry): Promise<boolean> {
  if (typeof FontFace === 'undefined') return false;
  const set = fontFaceSet();
  if (!set) return false;
  const url = bundledFontUrl(entry.file!);
  if (!url) return false;
  try {
    const face = new FontFace(entry.family, `url("${url}") format("woff2")`, {
      style: 'normal',
      weight: entry.weightRange ?? String(entry.weight),
    });
    const loaded = await face.load();
    set.add(loaded);
    ready.add(entry.family);
    return true;
  } catch (error) {
    console.warn(`WordWarp could not load the bundled font "${entry.family}"`, error);
    return false;
  }
}

/**
 * Font files ride the Vite asset pipeline rather than `public/` so their URLs are content-hashed
 * and, crucially, rebased correctly inside the export worker for every `VITE_BASE_PATH` flavour --
 * a `public/` URL built from `import.meta.env.BASE_URL` resolves against the worker module's own
 * URL under the portable `./` base and 404s.
 */
const fontAssets = import.meta.glob<string>('../assets/fonts/*.woff2', {
  eager: true,
  query: '?url',
  import: 'default',
});

export function bundledFontUrl(file: string): string | undefined {
  return fontAssets[`../assets/fonts/${file}`];
}

/**
 * The FontFaceSet lives on `document` in a window and directly on the global scope inside a
 * worker (which is where PNG export renders). Both expose the same `add`.
 */
function fontFaceSet(): FontFaceSet | undefined {
  if (typeof document !== 'undefined' && document.fonts) return document.fonts;
  return (globalThis as { fonts?: FontFaceSet }).fonts;
}
