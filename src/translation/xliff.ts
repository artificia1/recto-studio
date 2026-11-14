import {
  languageTag, MAX_TRANSLATION_UNITS, MAX_UNIT_LENGTH, MAX_XLIFF_BYTES, translationText,
  type TranslationGroup, type TranslationPart, type TranslationUnit,
} from './catalog';

export const xliffNamespace = 'urn:oasis:names:tc:xliff:document:2.0';

export interface ReturnedUnit {
  key: string;
  source: TranslationPart[];
  target?: TranslationPart[];
  targetError?: string;
  state: 'initial' | 'translated' | 'reviewed' | 'final';
}

export interface ReturnedTranslation {
  sourceLanguage: string;
  targetLanguage: string;
  units: ReturnedUnit[];
}

const escapeXml = (value: string) => value.replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);

function partsXml(parts: TranslationPart[], codes: TranslationUnit['codes'], source: boolean): string {
  return parts.map(part => {
    if (part.kind === 'text') return escapeXml(part.text);
    const policy = source ? ' canCopy="no" canDelete="no"' : '';
    if (part.kind === 'format') return `<pc id="${part.id}"${policy}>${escapeXml(part.text)}</pc>`;
    const run = codes.get(part.id);
    const display = run?.noteId ? 'Note marker' : run?.reference ? 'Cross-reference' : run?.indexId ? 'Index marker' : 'Publication field';
    return `<ph id="${part.id}"${policy}${source ? ` disp="${display}"` : ''}/>`;
  }).join('');
}

export function writeTranslationExchange(groups: TranslationGroup[], source: string, target: string,
  translations: ReadonlyMap<string, TranslationPart[]> = new Map()) {
  const sourceLanguage = languageTag(source);
  const targetLanguage = languageTag(target);
  if (sourceLanguage === targetLanguage) throw new Error('Choose a target language different from the source.');
  if (!groups.some(group => group.units.length)) throw new Error('Select at least one group to translate.');
  const entries = groups.map(group => {
    const units = group.units.map(unit => {
      const target = translations.get(unit.key);
      const sourceXml = partsXml(unit.source, unit.codes, true);
      const targetXml = target ? `<target xml:space="preserve">${partsXml(target, unit.codes, false)}</target>` : '';
      const context = [group.label, unit.label, unit.page === undefined ? undefined : `Page ${unit.page}`].filter(Boolean).join(' · ');
      return `<unit id="${unit.key}" canResegment="no"><notes><note>${escapeXml(context)}</note></notes><segment id="s1"${target ? ' state="reviewed"' : ''}><source xml:space="preserve">${sourceXml}</source>${targetXml}</segment></unit>`;
    }).join('\n');
    return `<group id="${group.id}">\n${units}\n</group>`;
  }).join('\n');
  const output = `<?xml version="1.0" encoding="UTF-8"?>\n<xliff xmlns="${xliffNamespace}" version="2.0" srcLang="${sourceLanguage}" trgLang="${targetLanguage}">\n<file id="recto-publication">\n${entries}\n</file>\n</xliff>\n`;
  if (new Blob([output]).size > MAX_XLIFF_BYTES) throw new Error('The XLIFF exceeds 16 MiB. Export smaller selections.');
  return output;
}

interface XmlNode {
  nodeType: number;
  nodeValue: string | null;
}

interface XmlElement extends XmlNode {
  localName: string | null;
  namespaceURI: string | null;
  textContent: string | null;
  children: Iterable<XmlElement> & ArrayLike<XmlElement>;
  childNodes: Iterable<XmlNode>;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
}

function direct(parent: XmlElement, name: string) {
  return [...parent.children].filter(node => node.namespaceURI === xliffNamespace && node.localName === name);
}

function parseParts(container: XmlElement): TranslationPart[] {
  const parts: TranslationPart[] = [];
  for (const node of container.childNodes) {
    if (node.nodeType === 3 || node.nodeType === 4) {
      const text = node.nodeValue || '';
      const last = parts.at(-1);
      if (last?.kind === 'text') last.text += text;
      else if (text) parts.push({ kind: 'text', text });
      continue;
    }
    if (node.nodeType === 8) continue;
    if (node.nodeType !== 1) throw new Error('Unsupported inline content in the translation.');
    const element = node as XmlElement;
    if (element.namespaceURI !== xliffNamespace || (element.localName !== 'ph' && element.localName !== 'pc')) {
      throw new Error('Preserve the original inline codes. This exchange supports the XLIFF pc and ph elements.');
    }
    const id = element.getAttribute('id') || '';
    if (!/^(?:[1-9]\d{0,5}|m[1-9]\d{0,5}-[a-f0-9]{2,4096})$/.test(id) || element.children.length || element.hasAttribute('copyOf')) {
      throw new Error('An inline code was changed, copied or nested.');
    }
    if (element.localName === 'ph') {
      if (element.textContent) throw new Error('A protected marker contains unexpected text.');
      parts.push({ kind: 'marker', id });
    } else {
      parts.push({ kind: 'format', id, text: element.textContent || '' });
    }
  }
  if (translationText(parts).length > MAX_UNIT_LENGTH) throw new Error('A translation unit exceeds 24,000 characters.');
  return parts;
}

export function readTranslationExchange(xml: string, parseRoot: (text: string) => XmlElement | null = (text: string) =>
  new DOMParser().parseFromString(text, 'application/xml').documentElement): ReturnedTranslation {
  if (xml.length > MAX_XLIFF_BYTES || new Blob([xml]).size > MAX_XLIFF_BYTES) throw new Error('Choose an XLIFF smaller than 16 MiB.');
  if (/<!DOCTYPE\b|<!ENTITY\b/i.test(xml)) throw new Error('XLIFF files cannot contain document type or entity declarations.');
  const root = parseRoot(xml);
  if (root?.localName !== 'xliff' || root.namespaceURI !== xliffNamespace || root.getAttribute('version') !== '2.0') {
    throw new Error('Choose a well-formed XLIFF 2.0 file exported from Recto.');
  }
  const sourceLanguage = languageTag(root.getAttribute('srcLang') || '');
  const targetLanguage = languageTag(root.getAttribute('trgLang') || '');
  if (sourceLanguage === targetLanguage) throw new Error('The XLIFF source and target languages match.');
  const units: ReturnedUnit[] = [];
  const seen = new Set<string>();
  const files = direct(root, 'file');
  if (files.length !== 1 || files[0].getAttribute('id') !== 'recto-publication') {
    throw new Error('Choose a Recto exchange with its original file ID.');
  }
  const queue = [...files[0].children].reverse();
  let visited = 0;
  while (queue.length) {
    const node = queue.pop()!;
    if (++visited > MAX_TRANSLATION_UNITS * 4) throw new Error('The XLIFF has too many groups or units.');
    if (node.namespaceURI !== xliffNamespace) continue;
    if (node.localName === 'group') {
      for (let index = node.children.length - 1; index >= 0; index--) queue.push(node.children[index]);
      continue;
    }
    if (node.localName !== 'unit') continue;
    if (units.length >= MAX_TRANSLATION_UNITS) throw new Error('The XLIFF exceeds 12,000 units.');
    const key = node.getAttribute('id') || '';
    if (!/^u-[a-f0-9]{2,4096}$/.test(key) || seen.has(key)) throw new Error('The XLIFF contains an invalid or duplicate unit ID.');
    seen.add(key);
    const segments = direct(node, 'segment');
    if (segments.length !== 1 || direct(node, 'ignorable').length) throw new Error('Keep each Recto unit in its original single segment.');
    const segment = segments[0];
    const sources = direct(segment, 'source'), targets = direct(segment, 'target');
    if (sources.length !== 1 || targets.length > 1) throw new Error('Each unit must have one source and at most one target.');
    const status = segment.getAttribute('state') || 'initial';
    if (!['initial', 'translated', 'reviewed', 'final'].includes(status)) throw new Error('An XLIFF segment has an invalid state.');
    const unit: ReturnedUnit = { key, source: parseParts(sources[0]), state: status as ReturnedUnit['state'] };
    if (targets[0]) {
      try { unit.target = parseParts(targets[0]); }
      catch (error) { unit.targetError = error instanceof Error ? error.message : String(error); }
    }
    units.push(unit);
  }
  if (!units.length) throw new Error('The XLIFF contains no translation units.');
  return { sourceLanguage, targetLanguage, units };
}
