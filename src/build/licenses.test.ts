import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkBundledModules, checkServiceWorkerNotices, collectLicenses } from './licenses';

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
    // Plugin code compiled into the app: the registerSW client and the generated service worker.
    expect(npm).toContain('vite-plugin-pwa@');
    expect(npm).toContain('workbox-build@');
    expect(npm).toContain('@trickfilm400/rollup-plugin-off-main-thread@');
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

  it('maps plugin-injected modules to inventory packages and rejects unknown ones', () => {
    const root = resolve(import.meta.dirname, '../..');
    const inventory = collectLicenses(root);
    checkBundledModules(root, [
      join(root, 'index.html'), join(root, 'src/main.tsx'), join(root, 'node_modules/react/index.js'),
      '\0rolldown/runtime.js', '\0vite/preload-helper.js', '/@vite-plugin-pwa/virtual:pwa-register',
    ], inventory);
    const withoutPwa = { ...inventory, packageNames: new Set([...inventory.packageNames].filter((name) => name !== 'vite-plugin-pwa')) };
    expect(() => checkBundledModules(root, ['/@vite-plugin-pwa/virtual:pwa-register'], withoutPwa)).toThrow(/vite-plugin-pwa module is missing/);
    expect(() => checkBundledModules(root, ['\0some-plugin/helper.js'], inventory)).toThrow(/no license inventory mapping/);
    expect(() => checkBundledModules(root, ['/@other-plugin/virtual:thing'], inventory)).toThrow(/no license inventory mapping/);
  });

  it('refuses a service worker whose generator packages are not in the shipped manifest', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'wordwarp-sw-test-'));
    try {
      mkdirSync(join(outDir, 'licenses'));
      writeFileSync(join(outDir, 'licenses/manifest.json'), JSON.stringify({ packages: [{ name: 'workbox-build' }] }));
      checkServiceWorkerNotices(outDir);
      writeFileSync(join(outDir, 'sw.js'), '');
      expect(() => checkServiceWorkerNotices(outDir)).toThrow(/rollup-plugin-off-main-thread/);
    } finally { rmSync(outDir, { recursive: true, force: true }); }
  });
});
