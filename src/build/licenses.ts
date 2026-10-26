import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, posix, relative, resolve } from 'node:path';
import type { Plugin, Rolldown } from 'vite';

type Package = { name?: string; version: string; license?: string; dev?: boolean; dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> };
type Lockfile = { packages: Record<string, Package> };
type Notice = { path: string; text: string; sha256: string };
type Font = {
  family: string; file: string; license: string; licenseFile: string; sha256: string;
  distribution: { licenseSha256: string };
};

const reviewedLicenses = new Set(['MIT', 'ISC', '(MIT AND Zlib)', 'Apache-2.0']);
// Build-time packages whose own code ships: bundler runtime helpers, generated styles,
// vite-plugin-pwa's registerSW client, and the generated service worker (workbox-build's
// template plus the off-main-thread AMD loader). Their dependency closures do not ship.
const buildHelpers = new Set([
  'vite', 'rolldown', 'tailwindcss', '@babel/runtime', 'vite-plugin-pwa', 'workbox-build',
  '@trickfilm400/rollup-plugin-off-main-thread',
]);
// Plugin-injected modules have no node_modules path. Each maps to the package whose code it
// inlines; any other module outside node_modules and the project fails the build.
const virtualModulePackages: [prefix: string, name: string][] = [
  ['\0rolldown/', 'rolldown'],
  ['\0vite/', 'vite'],
  ['/@vite-plugin-pwa/', 'vite-plugin-pwa'],
];
// workbox-build writes these after generateBundle, so the chunk check cannot see them.
const serviceWorkerFiles = /^(?:sw|workbox-[0-9a-f]+)\.js$/;
const serviceWorkerPackages = ['workbox-build', '@trickfilm400/rollup-plugin-off-main-thread'];
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const read = (path: string) => readFileSync(path, 'utf8');
const slash = (path: string) => path.replaceAll('\\', '/');
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!);

function noticeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return noticeFiles(path);
    return entry.isFile() && /(?:^|[-_.])(licen[sc]e|copying|notice)(?:[-_.]|$)/i.test(entry.name)
      ? [path] : [];
  }).sort();
}

/** Build-only code. Preserve upstream notices verbatim, including secondary licenses. */
export function collectLicenses(root: string) {
  const lock = JSON.parse(read(join(root, 'package-lock.json'))) as Lockfile;
  const selected = new Set(Object.entries(lock.packages).filter(([path, entry]) => {
    const name = path.split('node_modules/').at(-1) ?? '';
    return path && (!entry.dev || (name.startsWith('workbox-') && name !== 'workbox-build'));
  }).map(([path]) => path));
  // Workbox emits the service worker separately. Its runtime closure can include nested
  // dependencies marked dev by npm, such as its older idb version; keep those notices too.
  // workbox-build itself comes in through buildHelpers, without its build-tool closure.
  for (const path of selected) {
    const entry = lock.packages[path]!;
    for (const dependency of Object.keys({ ...entry.dependencies, ...entry.optionalDependencies })) {
      let parent = path;
      let found: string | undefined;
      for (;;) {
        const candidate = posix.join(parent, 'node_modules', dependency);
        if (lock.packages[candidate]) { found = candidate; break; }
        if (parent === '.') break;
        parent = posix.dirname(parent);
      }
      if (found) selected.add(found);
      else if (!entry.optionalDependencies?.[dependency]) {
        throw new Error(`Missing runtime dependency in license inventory: ${path} -> ${dependency}`);
      }
    }
  }
  for (const path of Object.keys(lock.packages)) {
    if (buildHelpers.has(path.split('node_modules/').at(-1) ?? '')) selected.add(path);
  }
  const packages = [...selected].sort().map((path) => [path, lock.packages[path]!] as const);
  const inventory = packages.map(([path, entry]) => {
    const directory = join(root, path);
    const installed = JSON.parse(read(join(directory, 'package.json'))) as Package;
    const name = installed.name;
    if (!name || installed.version !== entry.version || installed.license !== entry.license) {
      throw new Error(`License inventory does not match the lockfile: ${path}. Run npm ci.`);
    }
    if (!entry.license || !reviewedLicenses.has(entry.license)) {
      throw new Error(`Review the redistribution terms before building: ${name} (${entry.license ?? 'missing license'}).`);
    }
    const files = noticeFiles(directory);
    // Pako's root LICENSE covers its JS port; the original zlib license is in this README.
    if (name === 'pako') files.push(join(directory, 'lib/zlib/README'));
    if (!files.length) throw new Error(`No full license text found for ${name}.`);
    const notices: Notice[] = [...new Set(files)].sort().map((file) => {
      const text = read(file);
      if (!text.trim()) throw new Error(`Empty third-party notice: ${file}`);
      return { path: slash(relative(directory, file)), text, sha256: sha256(text) };
    });
    return { name, version: entry.version, license: entry.license, path, notices };
  });
  const fontRoot = join(root, 'public/fonts');
  const fonts = (JSON.parse(read(join(fontRoot, 'SOURCES.json'))) as { fonts: Font[] }).fonts;
  for (const font of fonts) {
    if (sha256(readFileSync(join(root, 'src/assets/fonts', font.file))) !== font.sha256
      || sha256(readFileSync(join(fontRoot, font.licenseFile))) !== font.distribution.licenseSha256) {
      throw new Error(`Font or license changed without a provenance review: ${font.family}`);
    }
  }
  const npmText = inventory.map((entry) => [
    `${entry.name}@${entry.version} — ${entry.license}`, `Installed package: ${entry.path}`,
    ...entry.notices.map((notice) => `\n--- ${notice.path} ---\n${notice.text}`),
  ].join('\n')).join('\n\n' + '='.repeat(80) + '\n\n');
  const assets = new Map<string, string>([
    ['licenses/LICENSE.txt', read(join(root, 'LICENSE'))],
    ['licenses/LICENSING.md', read(join(root, 'LICENSING.md'))],
    ['licenses/THIRD_PARTY.md', read(join(root, 'THIRD_PARTY.md'))],
    ['licenses/npm-notices.txt', npmText],
  ]);
  const section = (title: string, content: string, open = false) =>
    `<details${open ? ' open' : ''}><summary>${escapeHtml(title)}</summary><pre>${escapeHtml(content)}</pre></details>`;
  const sections = [
    section('License scope and exclusions', assets.get('licenses/LICENSING.md')!, true),
    section('The Unlicense — original WordWarp material', assets.get('licenses/LICENSE.txt')!),
    section('Third-party attribution index', assets.get('licenses/THIRD_PARTY.md')!),
    section('Bundled fonts — copyright and provenance', read(join(fontRoot, 'LICENSE.txt'))),
    ...fonts.map((font) => section(`${font.family} — ${font.license}`, read(join(fontRoot, font.licenseFile)))),
    ...inventory.map((entry) => section(`${entry.name}@${entry.version} — ${entry.license}`,
      entry.notices.map((notice) => `--- ${notice.path} ---\n${notice.text}`).join('\n\n'))),
  ];
  assets.set('licenses/index.html', `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>WordWarp — Licenses &amp; credits</title>
<style>:root{color-scheme:light dark;font:16px/1.55 system-ui,sans-serif}body{max-width:960px;margin:auto;padding:32px 20px}h1{line-height:1.2}details{border:1px solid #8886;border-radius:8px;margin:12px 0;padding:12px 16px}summary{cursor:pointer;font-weight:600}pre{font:14px/1.55 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}@media print{details{break-inside:avoid}}</style>
<h1>WordWarp</h1><p>Licenses &amp; credits</p>
<p>Original WordWarp material is released under the Unlicense. The fonts and other third-party components keep their own licenses and copyright notices, reproduced below.</p>
${sections.join('\n')}</html>\n`);
  assets.set('licenses/manifest.json', JSON.stringify({
    format: 1,
    description: 'Conservative inventory: runtime dependencies, Workbox modules, and generated build helpers/styles. Not every component is used by every target.',
    packages: inventory.map(({ notices, ...entry }) => ({ ...entry, notices: notices.map(({ path, sha256 }) => ({ path, sha256 })) })),
    fonts: fonts.map(({ family, file, license, licenseFile, sha256: hash, distribution }) => ({
      family, sourceFile: `src/assets/fonts/${file}`, license, licenseFile: `fonts/${licenseFile}`,
      sha256: hash, licenseSha256: distribution.licenseSha256,
    })),
    files: Object.fromEntries([...assets].map(([path, text]) => [path, sha256(text)])),
  }, null, 2) + '\n');
  return {
    assets,
    packagePaths: new Set(inventory.map((entry) => resolve(root, entry.path))),
    packageNames: new Set(inventory.map((entry) => entry.name)),
  };
}

type Inventory = Pick<ReturnType<typeof collectLicenses>, 'packagePaths' | 'packageNames'>;

/** Fails when a bundled module comes from a package or plugin that the inventory lacks. */
export function checkBundledModules(root: string, moduleIds: Iterable<string>, inventory: Inventory) {
  for (const id of moduleIds) {
    const path = id.split('?')[0]!;
    const virtual = virtualModulePackages.find(([prefix]) => path.startsWith(prefix));
    if (virtual) {
      if (!inventory.packageNames.has(virtual[1])) {
        throw new Error(`Bundled ${virtual[1]} module is missing from the license inventory: ${id}`);
      }
      continue;
    }
    if (!path.includes('/node_modules/')) {
      // Project sources and HTML entries are WordWarp's own code.
      const local = slash(relative(root, path));
      if (!path.startsWith('\0') && local && !local.startsWith('../') && !isAbsolute(local)) continue;
      throw new Error(`Bundled module has no license inventory mapping: ${JSON.stringify(id)}`);
    }
    let directory = dirname(path);
    while (directory.includes('node_modules')) {
      const metadata = join(directory, 'package.json');
      if (existsSync(metadata) && (JSON.parse(read(metadata)) as Package).name) break;
      directory = dirname(directory);
    }
    if (!inventory.packagePaths.has(directory)) {
      throw new Error(`Bundled package is missing from the license inventory: ${id}`);
    }
  }
}

function checkBundle(root: string, bundle: Rolldown.OutputBundle, inventory: Inventory) {
  for (const output of Object.values(bundle)) {
    if (output.type === 'chunk') checkBundledModules(root, output.moduleIds, inventory);
  }
}

/** Fails when the generated service worker ships without its packages' notices. */
export function checkServiceWorkerNotices(outDir: string) {
  if (!readdirSync(outDir).some((file) => serviceWorkerFiles.test(file))) return;
  const manifest = JSON.parse(read(join(outDir, 'licenses/manifest.json'))) as { packages: { name: string }[] };
  const listed = new Set(manifest.packages.map((entry) => entry.name));
  const missing = serviceWorkerPackages.filter((name) => !listed.has(name));
  if (missing.length) {
    throw new Error(`The service worker ships code from packages missing from licenses/manifest.json: ${missing.join(', ')}`);
  }
}

/** Vite builds workers with worker.plugins only; check their modules without emitting notices. */
export function workerLicenseCheck(): Plugin {
  let root: string;
  return {
    name: 'wordwarp-worker-license-check',
    configResolved(config) { root = config.root; },
    generateBundle(_options, bundle) { checkBundle(root, bundle, collectLicenses(root)); },
  };
}

export function licenseNotices(): Plugin {
  let root: string;
  let base: string;
  let outDir: string;
  let emitted = false;
  return {
    name: 'wordwarp-license-notices',
    configResolved(config) { root = config.root; base = config.base; outDir = resolve(root, config.build.outDir); },
    configureServer(server) {
      const { assets } = collectLicenses(root);
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? '').split('?')[0]!;
        const key = path.startsWith(base) ? path.slice(base.length) : path.replace(/^\//, '');
        const asset = assets.get(key);
        if (asset === undefined) return next();
        response.setHeader('Content-Type', key.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8');
        response.end(asset);
      });
    },
    generateBundle(_options, bundle) {
      const { assets, ...inventory } = collectLicenses(root);
      checkBundle(root, bundle, inventory);
      for (const [fileName, source] of assets) this.emitFile({ type: 'asset', fileName, source });
      emitted = true;
    },
    // After vite-plugin-pwa's closeBundle has written sw.js and the Workbox chunk.
    closeBundle: {
      order: 'post',
      handler(error) {
        if (!error && emitted) checkServiceWorkerNotices(outDir);
      },
    },
  };
}
