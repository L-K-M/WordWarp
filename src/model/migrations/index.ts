import { DOC_VERSION } from '../types';
import { parseDocument } from '../schema';
import type { WordWarpDocument } from '../types';

export type Migration = (document: Record<string, unknown>) => Record<string, unknown>;

const migrations = new Map<number, Migration>();

export function registerMigration(fromVersion: number, migration: Migration): void {
  if (migrations.has(fromVersion)) {
    throw new Error(`Migration from version ${fromVersion} is already registered`);
  }
  migrations.set(fromVersion, migration);
}

// v1 -> v2: drop ExtrudeEffect.facePaint and ExtrudeEffect.capBack.
//
// Neither was ever read by the renderer. The extruded face is painted by the element's own fill
// effect, so a second face paint on the extrusion had no meaning, and nothing capped the back of
// the prism. Both are removed rather than implemented so the schema stops advertising controls
// that do nothing.
registerMigration(1, (document) => {
  const elements = Array.isArray(document.elements) ? document.elements : [];
  for (const element of elements) {
    if (!element || typeof element !== 'object') continue;
    const effects = (element as { effects?: unknown }).effects;
    if (!Array.isArray(effects)) continue;
    for (const effect of effects) {
      if (!effect || typeof effect !== 'object') continue;
      if ((effect as { kind?: unknown }).kind !== 'extrude') continue;
      delete (effect as Record<string, unknown>).facePaint;
      delete (effect as Record<string, unknown>).capBack;
    }
  }
  return { ...document, version: 2 };
});

// v2 -> v3: give every shape element an explicit `path`.
//
// Shapes gained a `path` field so a stamp can later be detached from its generator and edited as
// geometry. `null` is the generating form, and it has to be written rather than left absent
// because the document schema is strict about unknown *and* missing keys.
//
// In practice this rewrites nothing: no version of the app could create a shape element, and the
// renderer refused to draw one, so no saved document contains any. It is registered anyway,
// because "nobody could have made one" is an argument about the past, and hand-authored and
// third-party documents are not bound by it.
registerMigration(2, (document) => {
  const elements = Array.isArray(document.elements) ? document.elements : [];
  for (const element of elements) {
    if (!element || typeof element !== 'object') continue;
    if ((element as { type?: unknown }).type !== 'shape') continue;
    const shape = element as Record<string, unknown>;
    shape.path ??= null;
  }
  return { ...document, version: 3 };
});

// v3 -> v4: widen the persisted stamp catalogue.
//
// No existing stamp id needs rewriting, but an enum is part of the document contract: a stale v3
// client cannot validate a new motif. Existing elements remain unchanged.
registerMigration(3, (document) => ({ ...document, version: 4 }));

export function loadDocument(value: unknown): WordWarpDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Document must be an object');
  }

  let current = structuredClone(value) as Record<string, unknown>;
  let version = readVersion(current);

  if (version > DOC_VERSION) {
    throw new Error(`Document version ${version} is newer than supported version ${DOC_VERSION}`);
  }

  while (version < DOC_VERSION) {
    const migration = migrations.get(version);
    if (!migration) {
      throw new Error(`No migration is registered from document version ${version}`);
    }
    current = migration(current);
    const nextVersion = readVersion(current);
    if (nextVersion !== version + 1) {
      throw new Error(`Migration from version ${version} must produce version ${version + 1}`);
    }
    version = nextVersion;
  }

  return parseDocument(current);
}

function readVersion(document: Record<string, unknown>): number {
  const version = document.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    throw new Error('Document version must be a non-negative integer');
  }
  return version;
}
