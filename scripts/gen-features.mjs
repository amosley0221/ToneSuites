#!/usr/bin/env node
// Generate FEATURES.md from every module's menus.ts (the command inventory) with each item's status.
// Run: npm run features   (CI fails if FEATURES.md is stale)
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// menus.ts files are TypeScript; re-run under Node's type stripping if needed.
if (!process.execArgv.some((a) => a.includes('strip-types')) && !process.env.TONE_FEATURES_CHILD) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL(import.meta.url).pathname], { stdio: 'inherit', env: { ...process.env, TONE_FEATURES_CHILD: '1' } });
  process.exit(r.status ?? 1);
}

const MODULES = [
  ['pixel', 'Pixel'], ['cells', 'Cells'], ['deck', 'Deck'], ['write', 'Write'], ['paper', 'Paper'],
];
const icon = { done: '✅', partial: '🟡', planned: '⬜' };
let out = '# Features\n\nGenerated from each module\'s menu inventory (`src/modules/*/menus.ts`) by `npm run features`.\n' +
  'Every command in the design exists in the app; this tracks which ones are fully working.\n\n' +
  '✅ done · 🟡 partial · ⬜ planned (listed in the menu, shows "on the roadmap" when used)\n';
const totals = { done: 0, partial: 0, planned: 0 };
for (const [id, name] of MODULES) {
  let menus;
  try {
    const m = await import(new URL(`../src/modules/${id}/menus.ts`, import.meta.url));
    // Accept `menus`, `<id>Menus` or the default export.
    menus = m.menus ?? m[`${id}Menus`] ?? m.default;
    if (!Array.isArray(menus)) throw new Error('no MenuDef[] export');
  }
  catch (e) { out += `\n## ${name}\n\n_menus.ts not found (${e.code ?? e.message})_\n`; continue; }
  const count = { done: 0, partial: 0, planned: 0 };
  let body = '';
  const walk = (entries, depth) => {
    for (const e of entries) {
      if (e === '-') continue;
      if (e.children) { body += `${'  '.repeat(depth)}- **${e.label}**\n`; walk(e.children, depth + 1); continue; }
      const st = e.status ?? 'planned';
      count[st]++; totals[st]++;
      body += `${'  '.repeat(depth)}- ${icon[st]} ${e.label}${e.shortcut ? ` \`${e.shortcut}\`` : ''}\n`;
    }
  };
  for (const m of menus) { body += `\n### ${m.name}\n\n`; walk(m.items, 0); }
  out += `\n## ${name}\n\n${count.done} done · ${count.partial} partial · ${count.planned} planned\n${body}`;
}
out += `\n---\n\nTotal: ${totals.done} done · ${totals.partial} partial · ${totals.planned} planned\n`;
writeFileSync(new URL('../FEATURES.md', import.meta.url), out);
console.log(`FEATURES.md: ${totals.done} done, ${totals.partial} partial, ${totals.planned} planned`);
