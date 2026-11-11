import type { TranslationReview, TranslationReviewRow } from './review';
import type { TranslationQualityFinding } from './quality';

export const translationStatusNames: Record<TranslationReviewRow['status'], string> = {
  ready: 'Ready',
  draft: 'Draft',
  missing: 'No translation',
  unchanged: 'Unchanged',
  conflict: 'Source changed',
  invalid: 'Invalid inline codes',
  unknown: 'Source missing',
};

const html = (value: string) => value.replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

const stylesheet = `
  :root { color-scheme: light; font: 16px/1.5 system-ui, sans-serif; color: #172332; background: #f4f6f8; }
  body { margin: auto; max-width: 72rem; padding: 2rem 1rem; }
  h1, h2, h3 { line-height: 1.25; margin: 0 0 .5rem; overflow-wrap: anywhere; }
  h1 { font-size: 2.4rem; }
  h2 { font-size: 1.55rem; }
  h3 { font-size: 1rem; }
  a { color: #09517b; }
  header, section { background: white; border: 1px solid #dce2e9; border-radius: .35rem; padding: 1.25rem; margin-bottom: 1rem; }
  nav ul, .warnings { margin: .4rem 0; padding-inline-start: 1.4rem; }
  nav ul { columns: 2; }
  nav li { break-inside: avoid; }
  article { border-top: 1px solid #dce2e9; padding: 1rem 0 .6rem; }
  .row { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 1rem; }
  .row p { white-space: pre-wrap; overflow-wrap: anywhere; margin: .25rem 0 .5rem; }
  .row > div { background: #f7f9fb; padding: .7rem; }
  .meta, small { color: #435567; }
  .warnings { color: #763719; }
  .state { display: flex; gap: .7rem 1rem; flex-wrap: wrap; margin: .5rem 0; }
  .state div { display: flex; align-items: baseline; gap: .4rem; }
  dt { color: #435567; }
  dd { font-weight: 700; margin: 0; }
  .skip { position: absolute; left: .75rem; top: -8rem; background: white; padding: .5rem; }
  .skip:focus { top: .75rem; }
  @media (max-width: 38rem) { .row { grid-template-columns: 1fr; } nav ul { columns: 1; } }
  @media print {
    :root { background: white; }
    body { max-width: none; padding: 0; }
    header, section { border: 0; padding: 0; }
    article, h2, h3 { break-inside: avoid; }
    .row > div { background: transparent; border: 1px solid #ddd; }
    nav, .skip { display: none; }
  }
`;

export function translationReviewHtml(title: string, review: TranslationReview, selected: ReadonlySet<string>,
  findings: TranslationQualityFinding[]) {
  const warnings = new Map<string, string[]>();
  for (const item of findings) {
    const messages = warnings.get(item.key);
    if (messages) messages.push(item.message);
    else warnings.set(item.key, [item.message]);
  }
  const groups = new Map<string, TranslationReviewRow[]>();
  const counts = new Map<TranslationReviewRow['status'], number>();
  for (const row of review.rows) {
    const list = groups.get(row.group);
    if (list) list.push(row);
    else groups.set(row.group, [row]);
    counts.set(row.status, (counts.get(row.status) || 0) + 1);
  }
  const sections = [...groups].map(([name, rows], index) => {
    const id = `group-${index + 1}`;
    const content = rows.map(row => {
      const messages = [...(row.detail ? [row.detail] : []), ...(warnings.get(row.key) || [])];
      const status = selected.has(row.key) ? 'Selected for edition' : translationStatusNames[row.status];
      return `<article><h3>${html(row.label)}</h3><p class="meta">${row.page === undefined ? '' : `Page ${row.page} · `}${html(status)}</p>
<div class="row"><div><small>Source</small><p lang="${html(review.sourceLanguage)}" dir="auto">${html(row.source)}</p></div>
<div><small>Translation</small><p lang="${html(review.targetLanguage)}" dir="auto">${html(row.target ?? '—')}</p></div></div>
${messages.length ? `<ul class="warnings">${messages.map(message => `<li>${html(message)}</li>`).join('')}</ul>` : ''}</article>`;
    }).join('\n');
    return { link: `<li><a href="#${id}">${html(name)}</a></li>`,
      body: `<section id="${id}" aria-labelledby="${id}-title"><h2 id="${id}-title">${html(name)}</h2>${content}</section>` };
  });
  const totals = [...counts].map(([status, count]) => `<div><dt>${html(translationStatusNames[status])}</dt><dd>${count}</dd></div>`).join('');
  const output = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${html(title)} · Translation review</title><style>${stylesheet}</style></head>
<body><a class="skip" href="#review">Skip to translation review</a>
<header><h1>${html(title)}</h1><p>Translation review · ${html(review.sourceLanguage)} → ${html(review.targetLanguage)}</p>
<dl class="state"><div><dt>Selected</dt><dd>${selected.size}</dd></div>${totals}</dl>
<nav aria-label="Translation groups"><ul>${sections.map(section => section.link).join('')}</ul></nav></header>
<main id="review">${sections.map(section => section.body).join('\n')}</main></body></html>`;
  if (new Blob([output]).size > 32 * 1024 * 1024) throw new Error('The bilingual review exceeds 32 MiB. Review a smaller exchange.');
  return output;
}
