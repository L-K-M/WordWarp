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
