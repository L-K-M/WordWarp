import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectLicenses } from './licenses';

describe('redistribution notices', () => {
  it('preserves full secondary licenses and every verified font license in the offline page', () => {
    const root = resolve(import.meta.dirname, '../..');
    const first = collectLicenses(root);
    const second = collectLicenses(root);
    expect([...first.assets]).toEqual([...second.assets]);
    const npm = first.assets.get('licenses/npm-notices.txt')!;
    expect(npm).toContain(readFileSync(join(root, 'node_modules/pako/lib/zlib/README'), 'utf8'));
    expect(npm).toContain(readFileSync(join(root, 'node_modules/rolldown/THIRD-PARTY-LICENSE'), 'utf8'));
    expect(npm).toContain('workbox-precaching@');
    expect(npm).toContain('idb@7.1.1');
    expect(npm).toContain('node_modules/workbox-expiration/node_modules/idb');
    expect(npm).toContain('react@');
    const page = first.assets.get('licenses/index.html')!;
    expect(page).toContain('Luckiest Guy — Apache-2.0');
    expect(page).toContain('Slackey — Apache-2.0');
    expect(page).toContain('SIL OPEN FONT LICENSE');
    expect(page).not.toMatch(/<script|<link|<iframe/);
    const manifest = JSON.parse(first.assets.get('licenses/manifest.json')!) as { fonts: unknown[] };
    expect(manifest.fonts).toHaveLength(13);
  });

  it.each([
    { license: 'Proprietary', installedVersion: '1.0.0', message: /Review the redistribution terms/ },
    { license: 'MIT', installedVersion: '2.0.0', message: /does not match the lockfile/ },
    { license: 'MIT', installedVersion: '1.0.0', message: /No full license text found/ },
  ])('refuses an unreviewed or incomplete dependency: $license / $installedVersion', ({ license, installedVersion, message }) => {
    const root = mkdtempSync(join(tmpdir(), 'wordwarp-license-test-'));
    try {
      mkdirSync(join(root, 'node_modules/example'), { recursive: true });
      writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ packages: {
        'node_modules/example': { version: '1.0.0', license },
      } }));
      writeFileSync(join(root, 'node_modules/example/package.json'), JSON.stringify({ name: 'example', version: installedVersion, license }));
      expect(() => collectLicenses(root)).toThrow(message);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
