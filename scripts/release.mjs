#!/usr/bin/env node
// Cut a release: move "## [Unreleased]" notes under the new version, bump versions and commit.
// Usage: node scripts/release.mjs <patch|minor|major|x.y.z> [--push]
// Pushing the version bump to main triggers .github/workflows/release.yml, which builds Windows,
// macOS and Android, attaches the update notes, creates the vX.Y.Z tag and publishes the GitHub
// Release (Vault + the desktop updater read it).
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const write = (p, s) => writeFileSync(new URL(p, root), s);
const sh = (c) => execSync(c, { stdio: 'inherit', cwd: root });

const arg = process.argv[2];
if (!arg) { console.error('usage: release.mjs <patch|minor|major|x.y.z> [--push]'); process.exit(2); }
const pkg = JSON.parse(read('package.json'));
const [ma, mi, pa] = pkg.version.split('.').map(Number);
const next = arg === 'major' ? `${ma + 1}.0.0` : arg === 'minor' ? `${ma}.${mi + 1}.0` : arg === 'patch' ? `${ma}.${mi}.${pa + 1}` : arg.replace(/^v/, '');
if (!/^\d+\.\d+\.\d+$/.test(next)) { console.error(`bad version ${next}`); process.exit(2); }

let changelog = read('CHANGELOG.md');
const unreleased = /^## \[Unreleased\]\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(changelog);
const hasSection = new RegExp(`^## \\[${next.replace(/\./g, '\\.')}\\]`, 'm').test(changelog);
if (!hasSection) {
  if (!unreleased || !unreleased[1].trim()) {
    console.error('Add update notes under "## [Unreleased]" in CHANGELOG.md first — every release needs notes.');
    process.exit(1);
  }
  const date = new Date().toISOString().slice(0, 10);
  changelog = changelog.replace(/^## \[Unreleased\]\s*\n/m, `## [Unreleased]\n\n## [${next}] - ${date}\n`);
  write('CHANGELOG.md', changelog);
}

pkg.version = next;
write('package.json', JSON.stringify(pkg, null, 2) + '\n');
const lock = JSON.parse(read('package-lock.json'));
lock.version = next;
if (lock.packages?.['']) lock.packages[''].version = next;
write('package-lock.json', JSON.stringify(lock, null, 2) + '\n');
write('src-tauri/Cargo.toml', read('src-tauri/Cargo.toml').replace(/^version = ".*"$/m, `version = "${next}"`));

sh('git add CHANGELOG.md package.json package-lock.json src-tauri/Cargo.toml');
sh(`git commit -m "Release v${next}"`);
if (process.argv.includes('--push')) sh('git push origin HEAD:main');
else console.log(`\nCommitted v${next}. Push to main to build and publish it: git push origin HEAD:main`);
