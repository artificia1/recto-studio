import { parseMarkdownContent } from '../contentImport';
import type { ParagraphStyle } from '../types';
import { warmLayout } from './layoutRuntime';
import { composeManuscript } from './manuscriptCompilation';
import { readPlacedImage } from './placedImage';
import { measureStoryText } from './storyLayout';

const maxMarkdownBytes = 8 * 1024 * 1024;
const fontFamily = 'Times New Roman, serif';

export async function importMarkdownBook(file: File, artwork: readonly File[] = []) {
  if (file.size > maxMarkdownBytes) throw new Error('Choose a Markdown manuscript smaller than 8 MB.');
  const bytes = await file.arrayBuffer();
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const sourceLines = source.split(/\r\n?|\n/);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const sourceRevision = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');

  // Only supplied files are eligible. A manuscript cannot fetch an image or open a path.
  const coverIndex = sourceLines.slice(0, 20).findIndex(line => /^\s*!\[[^\]]+\]\([\w. -]+\)\s*$/.test(line));
  const coverLink = coverIndex >= 0 ? /!\[([^\]]+)\]\(([\w. -]+)\)/.exec(sourceLines[coverIndex]) : null;
  const coverFile = coverLink && artwork.find(asset => asset.name === coverLink[2] && /\.(?:jpe?g|png|webp)$/i.test(asset.name));
  const cover = coverFile ? { ...await readPlacedImage(coverFile), altText: coverLink![1] } : undefined;
  if (cover) sourceLines[coverIndex] = '';

  const manuscript = parseMarkdownContent(cover ? sourceLines.join('\n') : source);
  const paragraphs = manuscript.content!.paragraphs;
  const textOf = (paragraph: typeof paragraphs[number]) => paragraph.runs.map(run => run.text).join('').trim();
  const heading = paragraphs.find(paragraph => paragraph.sourceStyle === 'Heading 1');
  const title = (heading && textOf(heading) || file.name.replace(/\.(?:md|markdown)$/i, '')).slice(0, 200);
  if (heading === paragraphs[0]) heading.styleId = 'style-title';
  const author = paragraphs.slice(0, 18).find(paragraph => !paragraph.sourceStyle?.startsWith('Heading') && /^By\s+\S/i.test(textOf(paragraph)));
  const paragraphStyles: ParagraphStyle[] = [3, 4, 5, 6].map(level => ({
    id: `style-h${level}`, name: `Heading ${level}`, pdfTag: `H${level}` as ParagraphStyle['pdfTag'],
    fontFamily, fontSizePt: 13 - (level - 2) * 0.5, lineHeight: 1.4, bold: true, letterSpacingPt: 0,
    color: '#222222', alignment: 'left', snapToBaseline: false, keepWithNext: true, keepTogether: true,
  }));
  paragraphStyles.push({ id: 'style-scene-break', name: 'Scene Break', fontFamily, fontSizePt: 11,
    lineHeight: 1.8, letterSpacingPt: 0, color: '#333333', alignment: 'center', snapToBaseline: false, keepWithNext: true });
  for (const paragraph of paragraphs) {
    const depth = /^Heading ([3-6])$/.exec(paragraph.sourceStyle ?? '')?.[1];
    if (depth) paragraph.styleId = `style-h${depth}`;
    if (paragraph.sourceStyle === 'Scene break') paragraph.styleId = 'style-scene-break';
  }

  await warmLayout();
  const book = composeManuscript(manuscript, { trim: 'trade-paperback-6x9', title,
    author: author && textOf(author).replace(/^By\s+/i, '').slice(0, 200), language: 'en',
    fontFamily, sourceRevision, padForDelivery: false, paragraphStyles, cover }, measureStoryText);
  return { ...book, warnings: manuscript.warnings ?? [] };
}
