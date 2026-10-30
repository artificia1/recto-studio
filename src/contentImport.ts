import { readZip } from './zip';
import { isInddBuffer, parseInddMetadata, type InddMetadata } from './engine/inddParser';
import type { StoryContent, StoryParagraph, StoryRun, TextFormatting } from './types';
import { compactRuns, plainStory, storyText } from './engine/storyContent';
import { child, children, descendants, nodeText, parseManuscriptXml, type XmlNode } from './import/manuscriptXml';

export interface ImportSourceStyle { name: string; suggestedStyleId: string; paragraphCount: number }
export interface IngestedStory {
  formattedText: string;
  detectedStyleId?: string;
  wordCount: number;
  content?: StoryContent;
  sourceStyles?: ImportSourceStyle[];
  warnings?: string[];
  inddMetadata?: InddMetadata;
}

function suggestedStyle(name: string): string {
  if (/^(heading|h)\s*1$|headline/i.test(name)) return 'style-h1';
  if (/^(heading|h)\s*[2-6]$|subhead/i.test(name)) return 'style-h2';
  if (/^title$/i.test(name)) return 'style-title';
  if (/quote/i.test(name)) return 'style-pullquote';
  return 'style-body';
}

function result(paragraphs: StoryParagraph[], warnings: string[] = []): IngestedStory {
  const content: StoryContent = { version: 1, paragraphs: paragraphs.length ? paragraphs : plainStory('').paragraphs };
  const formattedText = storyText(content);
  const styles = new Map<string, ImportSourceStyle>();
  for (const p of paragraphs) {
    const name = p.sourceStyle || 'Body';
    const entry = styles.get(name) || { name, suggestedStyleId: p.styleId || 'style-body', paragraphCount: 0 };
    entry.paragraphCount++;
    styles.set(name, entry);
  }
  return { content, formattedText, detectedStyleId: paragraphs[0]?.styleId || 'style-body',
    wordCount: formattedText.trim().split(/\s+/).filter(Boolean).length,
    sourceStyles: [...styles.values()], warnings: [...new Set(warnings)] };
}

/** Editorial Markdown subset; raw HTML is always literal text. */
function inlineMarkdown(text: string, marks: TextFormatting = {}, depth = 0): StoryRun[] {
  if (depth > 16) return [{ text, ...marks }];
  const runs: StoryRun[] = [];
  let plain = '';
  const flush = () => { if (plain) { runs.push({ text: plain, ...marks }); plain = ''; } };
  for (let i = 0; i < text.length;) {
    if (text[i] === '\\' && /[\\`*_[\]{}()#+.!>~-]/.test(text[i + 1] || '')) { plain += text[i + 1]; i += 2; continue; }
    const link = /^!?\[([^\]]*)\]\([^)]*\)/.exec(text.slice(i));
    if (link) { flush(); runs.push(...inlineMarkdown(link[1], marks, depth + 1)); i += link[0].length; continue; }
    const delimiter = ['***', '___', '**', '__', '*', '_', '`'].find(d => text.startsWith(d, i));
    if (delimiter && !(delimiter.includes('_') && /[\p{L}\p{N}]/u.test(text[i - 1] || ''))) {
      const close = text.indexOf(delimiter, i + delimiter.length);
      if (close > i + delimiter.length && !/\s/.test(text[i + delimiter.length])) {
        flush();
        const inner = text.slice(i + delimiter.length, close);
        runs.push(...(delimiter === '`' ? [{ text: inner, ...marks }] : inlineMarkdown(inner, {
          ...marks, ...(delimiter.length >= 2 ? { bold: true } : {}), ...(delimiter.length !== 2 ? { italic: true } : {}),
        }, depth + 1)));
        i = close + delimiter.length; continue;
      }
    }
    plain += text[i++];
  }
  flush();
  return compactRuns(runs);
}

export function parseMarkdownContent(markdown: string): IngestedStory {
  const paragraphs: StoryParagraph[] = [], warnings: string[] = [];
  let block: string[] = [], fenced = false;
  const add = (text: string, sourceStyle = 'Body') => paragraphs.push({ sourceStyle,
    styleId: suggestedStyle(sourceStyle), runs: inlineMarkdown(text) });
  const flush = () => { if (block.length) { add(block.join(' ')); block = []; } };
  for (const raw of markdown.replace(/^\uFEFF/, '').split(/\r\n?|\n/)) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) { flush(); fenced = !fenced; warnings.push('Code blocks are imported as plain paragraphs.'); continue; }
    if (fenced) { paragraphs.push({ sourceStyle: 'Code', styleId: 'style-body', runs: [{ text: raw }] }); continue; }
    if (!line) { flush(); continue; }
    const heading = /^(#{1,6})\s+(.+?)(?:\s+#+)?$/.exec(line);
    if (heading) { flush(); add(heading[2], `Heading ${heading[1].length}`); continue; }
    if (/^>\s?/.test(line)) { flush(); add(line.replace(/^>\s?/, ''), 'Quote'); continue; }
    if (/^(?:[-+*]|\d+[.)])\s+/.test(line)) {
      flush(); add(line.replace(/^[-+*]\s+/, '• '), 'List');
      warnings.push('Lists retain their visible markers; automatic list numbering is not imported.'); continue;
    }
    if (block.length && /^(?:=+|-+)\s*$/.test(line)) { add(block.join(' '), line[0] === '=' ? 'Heading 1' : 'Heading 2'); block = []; continue; }
    if (/^([-*_])(?:\s*\1){2,}$/.test(line)) { flush(); add('⁂', 'Scene break'); continue; }
    block.push(line);
  }
  flush();
  if (/!\[/.test(markdown)) warnings.push('Image labels are retained; place image files separately.');
  if (/\]\(/.test(markdown)) warnings.push('Link labels are retained; hyperlink destinations are not imported.');
  if (/<\/?[a-z][^>]*>/i.test(markdown)) warnings.push('HTML is retained as literal text and is never executed.');
  if (/\[\^/.test(markdown)) warnings.push('Footnote syntax is retained as text; automatic footnotes are not imported yet.');
  return result(paragraphs, warnings);
}

function runProperties(properties?: XmlNode): TextFormatting {
  const marks: TextFormatting = {};
  for (const [tag, key] of [['b', 'bold'], ['i', 'italic'], ['u', 'underline']] as const) {
    const item = child(properties, tag);
    if (item) marks[key] = !/^(0|false|off|none)$/.test(item.attrs.val || 'true');
  }
  return marks;
}

export async function parseDocxContent(buffer: ArrayBuffer | Uint8Array): Promise<IngestedStory> {
  const files = await readZip(buffer, 64 * 1024 * 1024);
  const document = files.get('word/document.xml');
  if (!document) throw new Error('Not a valid DOCX document: word/document.xml is missing.');
  const root = parseManuscriptXml(new TextDecoder().decode(document));
  const body = descendants(root, 'body')[0];
  if (!body) throw new Error('The DOCX has no document body.');
  const warnings: string[] = [];
  const definitions = new Map<string, { name: string; base?: string; marks: TextFormatting }>();
  const styleBytes = files.get('word/styles.xml');
  if (styleBytes) {
    for (const style of descendants(parseManuscriptXml(new TextDecoder().decode(styleBytes)), 'style')) {
      definitions.set(style.attrs.styleId, { name: child(style, 'name')?.attrs.val || style.attrs.styleId,
        base: child(style, 'basedOn')?.attrs.val, marks: runProperties(child(style, 'rPr')) });
    }
  }
  const inherited = (id: string | undefined, seen = new Set<string>()): TextFormatting => {
    if (!id || seen.has(id)) return {};
    seen.add(id);
    const definition = definitions.get(id);
    return definition ? { ...inherited(definition.base, seen), ...definition.marks } : {};
  };
  const paragraphs: StoryParagraph[] = [];
  for (const p of descendants(body, 'p')) {
    const pPr = child(p, 'pPr');
    const styleId = child(pPr, 'pStyle')?.attrs.val;
    const sourceStyle = definitions.get(styleId || '')?.name || styleId || 'Body';
    const runs: StoryRun[] = [];
    const walk = (node: XmlNode) => {
      if (node.name === 'del' || node.name === 'moveFrom') return;
      if (node.name === 'r') {
        const rPr = child(node, 'rPr');
        const marks = { ...inherited(styleId), ...inherited(child(rPr, 'rStyle')?.attrs.val), ...runProperties(rPr) };
        let text = '';
        for (const item of children(node)) {
          if (item.name === 't') text += nodeText(item);
          else if (item.name === 'tab') text += '\t';
          else if (item.name === 'br' || item.name === 'cr') text += '\n';
          else if (item.name === 'noBreakHyphen') text += '\u2011';
          else if (item.name === 'softHyphen') text += '\u00ad';
          else if (item.name === 'footnoteReference' || item.name === 'endnoteReference') text += `[${item.attrs.id || 'note'}]`;
        }
        if (text) runs.push({ text, ...marks });
        return;
      }
      for (const item of children(node)) if (item.name !== 'pPr') walk(item);
    };
    walk(p);
    if (child(pPr, 'numPr')) {
      runs.unshift({ text: '• ' });
      warnings.push('Word lists use bullet markers; numbering and nesting require review.');
    }
    paragraphs.push({ styleId: suggestedStyle(sourceStyle), sourceStyle, runs: compactRuns(runs) });
  }
  const has = (name: string) => descendants(body, name).length > 0;
  if (has('tbl')) warnings.push('Tables are flattened into paragraphs in reading order; rebuild table layout after import.');
  if (has('drawing') || has('pict')) warnings.push('Embedded images are not placed; add image files separately.');
  if (has('hyperlink')) warnings.push('Hyperlink text is retained; destinations are not imported.');
  if (has('ins') || has('del') || has('moveFrom') || has('moveTo')) warnings.push('Tracked changes are imported as accepted text; review the manuscript in Word first.');
  if (has('fldChar') || has('fldSimple')) warnings.push('Word fields use their cached text and will not update automatically.');
  if (has('footnoteReference') || has('endnoteReference')) {
    warnings.push('Note references use bracketed IDs. Note text is appended for review; automatic notes are not created.');
    for (const kind of ['footnotes', 'endnotes']) {
      const bytes = files.get(`word/${kind}.xml`);
      if (!bytes) continue;
      for (const note of descendants(parseManuscriptXml(new TextDecoder().decode(bytes)), kind === 'footnotes' ? 'footnote' : 'endnote')) {
        if (Number(note.attrs.id) > 0) paragraphs.push({ sourceStyle: 'Notes', styleId: 'style-body', runs: [{ text: `[${note.attrs.id}] ${descendants(note, 't').map(nodeText).join('')}` }] });
      }
    }
  }
  if ([...files.keys()].some(name => /^word\/(header|footer)\d*\.xml$/.test(name))) warnings.push('Headers, footers, and Word page geometry are not imported; set these in Recto.');
  warnings.push('Word typography is mapped to Recto paragraph styles. Bold, italic, and underline are preserved; other direct formatting requires review.');
  return result(paragraphs, warnings);
}

export function mapManuscriptStyles(story: IngestedStory, mapping: Record<string, string>): StoryContent {
  const content = story.content || plainStory(story.formattedText, story.detectedStyleId);
  return { version: 1, paragraphs: content.paragraphs.map(p => ({ ...p,
    styleId: mapping[p.sourceStyle || 'Body'] || p.styleId || 'style-body', runs: p.runs.map(r => ({ ...r })) })) };
}

export async function ingestManuscript(fileName: string, buffer: ArrayBuffer | Uint8Array): Promise<IngestedStory> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length > 32 * 1024 * 1024) throw new Error('Please use a manuscript smaller than 32 MB.');
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.indd') || isInddBuffer(buffer)) {
    const meta = parseInddMetadata(buffer);
    const formattedText = `${meta.title || 'Untitled InDesign Document'}\nPages: ${meta.pageCount}`;
    return { formattedText, wordCount: formattedText.split(/\s+/).length, inddMetadata: meta,
      warnings: ['This is a metadata preview. Use Import INDD for document recovery.'] };
  }
  if (lower.endsWith('.docx')) return parseDocxContent(buffer);
  if (!/\.(md|markdown|txt)$/.test(lower)) throw new Error('Choose a DOCX, Markdown, or plain text manuscript.');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
  if (/\.(md|markdown)$/.test(lower)) return parseMarkdownContent(text);
  return result(plainStory(text.replace(/\r\n?/g, '\n'), 'style-body').paragraphs);
}
