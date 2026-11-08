/** Quoted CSV/TSV fields, embedded newlines and CRLF; reject malformed input. */
export function parseDelimited(text: string, delimiter = ','): string[][] {
  if (text.length > 4 * 1024 * 1024) throw new Error('Data input must be smaller than 4 MB.');
  const rows: string[][] = []; let row: string[] = [], field = '', quoted = false, closed = false;
  const pushField = () => { row.push(field); field = ''; closed = false; if (row.length > 256) throw new Error('Use at most 256 columns.'); };
  const pushRow = () => { pushField(); rows.push(row); row = []; if (rows.length > 10001) throw new Error('Use at most 10,000 data records.'); };
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else field += char;
    } else if (char === delimiter) pushField();
    else if (char === '\n' || char === '\r') { if (char === '\r' && text[i + 1] === '\n') i++; pushRow(); }
    else if (char === '"' && !field && !closed) quoted = true;
    else if (closed && /\s/.test(char)) continue;
    else if (closed || char === '"') throw new Error('Invalid quoted field. Escape quotes by doubling them.');
    else field += char;
  }
  if (quoted) throw new Error('A quoted field is missing its closing quote.');
  if (field || row.length || closed) pushRow();
  return rows;
}

export function parseTableData(text: string, delimiter = text.includes('\t') ? '\t' : ','): string[][] {
  const rows = parseDelimited(text, delimiter);
  if (!rows.length || rows.length > 200 || rows[0].length > 20) throw new Error('Use between 1 and 200 rows and at most 20 columns.');
  const columns = rows[0].length;
  if (rows.some(row => row.length !== columns)) throw new Error('Every table row must have the same number of columns.');
  return rows;
}
