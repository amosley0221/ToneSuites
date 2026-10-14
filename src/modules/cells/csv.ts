// Delimited text (CSV / TSV) parsing and writing, RFC 4180 style quoting.

/** Guess the delimiter of a text file by looking at its first lines. */
export function sniffDelimiter(text: string, filename = ''): string {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'tsv' || ext === 'tab') return '\t';
  const sample = text.slice(0, 4096).split(/\r?\n/).slice(0, 5);
  const score = (d: string) => sample.reduce((n, line) => n + line.split(d).length - 1, 0);
  const cands = [',', '\t', ';', '|'];
  let best = ',';
  let bestScore = 0;
  for (const d of cands) {
    const s = score(d);
    if (s > bestScore) { best = d; bestScore = s; }
  }
  return best;
}

/** Parse delimited text into rows of fields. Handles quoted fields with embedded delimiters, quotes and newlines. */
export function parseDelimited(text: string, delim = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  let quoted = false;
  const n = text.length;
  if (text.charCodeAt(0) === 0xfeff) i = 1; // BOM
  let atFieldStart = true;
  while (i < n) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && atFieldStart) { quoted = true; atFieldStart = false; i++; continue; }
    if (ch === delim) { row.push(field); field = ''; atFieldStart = true; i++; continue; }
    if (ch === '\n' || ch === '\r') {
      row.push(field); rows.push(row); row = []; field = ''; atFieldStart = true;
      if (ch === '\r' && text[i + 1] === '\n') i++;
      i++; continue;
    }
    field += ch; atFieldStart = false; i++;
  }
  if (!atFieldStart || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function quoteField(s: string, delim: string): string {
  if (s.includes('"') || s.includes(delim) || s.includes('\n') || s.includes('\r') || /^\s|\s$/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function toDelimited(rows: string[][], delim = ','): string {
  return rows.map((r) => r.map((f) => quoteField(f, delim)).join(delim)).join('\r\n') + (rows.length ? '\r\n' : '');
}

/** TSV for the clipboard: Excel-compatible (quotes only when a field contains tab/newline/quote). */
export function toClipboardTsv(rows: string[][]): string {
  return rows.map((r) => r.map((f) => (/[\t\n\r"]/.test(f) ? '"' + f.replace(/"/g, '""') + '"' : f)).join('\t')).join('\n');
}

export function parseClipboardTsv(text: string): string[][] {
  const rows = parseDelimited(text.replace(/\r?\n$/, ''), '\t');
  return rows.length ? rows : [['']];
}
