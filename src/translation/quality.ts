import type { TranslationReview, TranslationReviewRow } from './review';

export interface GlossaryEntry { source: string; target: string }
export interface TranslationQualityFinding { key: string; message: string }

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const textBoundary = '[\\p{L}\\p{M}\\p{N}_]';

export function parseTranslationGlossary(value: string): GlossaryEntry[] {
  const terms = new Map<string, string>();
  if (value.length > 24000) throw new Error('Use a glossary smaller than 24,000 characters.');
  for (const [index, line] of value.split(/\r?\n/).entries()) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const delimiter = line.includes('\t') ? '\t' : '→';
    const parts = line.split(delimiter).map(part => part.trim().normalize('NFC'));
    if (parts.length !== 2 || parts.some(part => !part || part.length > 120)) {
      throw new Error(`Glossary line ${index + 1} needs one source term and one preferred translation.`);
    }
    if (terms.has(parts[0])) throw new Error(`Glossary line ${index + 1} repeats a source term.`);
    terms.set(parts[0], parts[1]);
    if (terms.size > 150) throw new Error('Use up to 150 glossary terms.');
  }
  return [...terms].map(([source, target]) => ({ source, target }));
}

export function formatTranslationGlossary(entries: GlossaryEntry[]) {
  return entries.map(entry => `${entry.source}\t${entry.target}`).join('\n') + (entries.length ? '\n' : '');
}

function termPattern(term: string) {
  return new RegExp(`(?<!${textBoundary})${escapeRegex(term)}(?!${textBoundary})`, 'iu');
}

function decimalReader(language: string) {
  const locale = new Intl.NumberFormat(language);
  const parts = locale.formatToParts(12345.67);
  const decimal = parts.find(part => part.type === 'decimal')?.value || '.';
  const group = parts.find(part => part.type === 'group')?.value;
  const digits = new Map<string, string>();
  for (let value = 0; value < 10; value++) {
    digits.set(String(value), String(value));
    const local = locale.formatToParts(value).find(part => part.type === 'integer')?.value;
    if (local) digits.set(local, String(value));
  }
  // Only include spaces when this locale uses them to group digits.
  const punctuation = new Set([decimal, group].filter((value): value is string => !!value));
  if (group && /\s/u.test(group)) for (const space of [' ', '\u00a0', '\u202f']) punctuation.add(space);
  const separators = [...punctuation].map(escapeRegex).join('|');
  const expression = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])[-+−]?\\p{Nd}+(?:(?:${separators})\\p{Nd}+)*(?![\\p{L}\\p{M}\\p{N}_])`, 'gu');
  return (text: string) => [...text.matchAll(expression)].flatMap(match => {
    let out = '';
    for (const char of match[0]) {
      if (char === decimal) out += '.';
      else if (punctuation.has(char)) continue;
      else if (char === '-' || char === '−') out += '-';
      else if (char !== '+') {
        const value = digits.get(char);
        if (value === undefined) return [];
        out += value;
      }
    }
    // Preserve precision for ISBNs and long catalog quantities.
    if (!/^-?\d+(?:\.\d+)?$/.test(out)) return [];
    const [integer, fractional] = out.split('.');
    const fraction = fractional?.replace(/0+$/, '');
    return [integer.replace(/^(-?)0+(?=\d)/, '$1') + (fraction ? `.${fraction}` : '')];
  }).sort();
}

export function translationQualityFindings(review: TranslationReview, glossary: GlossaryEntry[], checkNumbers: boolean) {
  const findings: TranslationQualityFinding[] = [];
  const terms = glossary.map(({ source, target }) => ({ source, target, from: termPattern(source), to: termPattern(target) }));
  const sourceNumbers = decimalReader(review.sourceLanguage), targetNumbers = decimalReader(review.targetLanguage);
  const maxFindings = 1000;
  const add = (row: TranslationReviewRow, message: string) => findings.push({ key: row.key, message });
  const plainVariants = new Map<string, Set<string>>();
  const plainUnits = new Map<string, { source: string; target: string }>();
  for (const [key, { unit, returned }] of review.candidates) {
    if (unit.codes.size || !returned.target) continue;
    const source = unit.source.map(part => part.kind === 'marker' ? '' : part.text).join('').normalize('NFC').trim();
    const target = returned.target.map(part => part.kind === 'marker' ? '' : part.text).join('').normalize('NFC').trim();
    let variants = plainVariants.get(source);
    if (!variants) plainVariants.set(source, variants = new Set());
    variants.add(target);
    plainUnits.set(key, { source, target });
  }
  for (const row of review.rows) {
    if (!review.candidates.has(row.key) || row.target === undefined) continue;
    const { unit, returned } = review.candidates.get(row.key)!;
    const source = unit.source.map(part => part.kind === 'marker' ? ' ' : part.text).join('').normalize('NFC');
    const target = returned.target!.map(part => part.kind === 'marker' ? ' ' : part.text).join('').normalize('NFC');
    if (checkNumbers && JSON.stringify(sourceNumbers(source)) !== JSON.stringify(targetNumbers(target))) {
      add(row, 'The numeric values differ after accounting for language-specific separators.');
    }
    const plain = plainUnits.get(row.key);
    if (plain && (plainVariants.get(plain.source)?.size || 0) > 1) {
      add(row, 'Identical source text has different translations. Check whether the wording should match.');
    }
    for (const term of terms) {
      if (term.from.test(source) && !term.to.test(target)) add(row, `Review “${term.source}”. The glossary prefers “${term.target}”.`);
      if (findings.length >= maxFindings) return { findings, limited: true };
    }
    if (findings.length >= maxFindings) return { findings, limited: true };
  }
  return { findings, limited: false };
}
