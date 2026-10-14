#!/usr/bin/env node
// Print the CHANGELOG.md section for a version (used by the release workflow for release notes).
// Usage: node scripts/changelog-section.mjs 1.2.3
import { readFileSync } from 'node:fs';

const version = (process.argv[2] || '').replace(/^v/, '');
if (!version) { console.error('usage: changelog-section.mjs <version>'); process.exit(2); }
const lines = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8').split('\n');
const esc = version.replace(/\./g, '\\.');
const start = lines.findIndex((l) => new RegExp(`^##\\s*\\[?v?${esc}\\]?(\\s|$)`).test(l));
if (start < 0) { console.error(`CHANGELOG.md has no section for ${version}`); process.exit(1); }
let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
if (end < 0) end = lines.length;
const body = lines.slice(start + 1, end).join('\n').trim();
if (!body) { console.error(`CHANGELOG.md section for ${version} is empty`); process.exit(1); }
process.stdout.write(body + '\n');
