import { readZip } from './zip';
import { extractXmlTags, extractXmlAttr } from './idmlImport';

export interface IngestedStory {
  formattedText: string;
  detectedStyleId?: string;
  wordCount: number;
}

export function parseMarkdownContent(markdown: string): IngestedStory {
  const lines = markdown.split(/\r?\n/);
  const processedParagraphs: string[] = [];
  let detectedStyleId: string | undefined;

  let currentBlock: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      if (currentBlock.length > 0) {
        processedParagraphs.push(currentBlock.join(' '));
        currentBlock = [];
      }
      continue;
    }

    // Markdown Heading 1 (# Headline)
    if (trimmed.startsWith('# ')) {
      if (currentBlock.length > 0) {
        processedParagraphs.push(currentBlock.join(' '));
        currentBlock = [];
      }
      const headingText = trimmed.replace(/^#\s+/, '').trim();
      processedParagraphs.push(headingText);
      if (!detectedStyleId) detectedStyleId = 'style-h1';
      continue;
    }

    // Markdown Heading 2 (## Subhead)
    if (trimmed.startsWith('## ')) {
      if (currentBlock.length > 0) {
        processedParagraphs.push(currentBlock.join(' '));
        currentBlock = [];
      }
      const h2Text = trimmed.replace(/^##\s+/, '').trim();
      processedParagraphs.push(h2Text);
      if (!detectedStyleId) detectedStyleId = 'style-h2';
      continue;
    }

    // Blockquote / Pullquote (> Quote text)
    if (trimmed.startsWith('>')) {
      if (currentBlock.length > 0) {
        processedParagraphs.push(currentBlock.join(' '));
        currentBlock = [];
      }
      const quoteText = trimmed.replace(/^>\s*/, '').trim();
      processedParagraphs.push(quoteText);
      if (!detectedStyleId) detectedStyleId = 'style-pullquote';
      continue;
    }

    // Unordered Bullet list (- Item or * Item)
    if (/^[-*]\s+/.test(trimmed)) {
      if (currentBlock.length > 0) {
        processedParagraphs.push(currentBlock.join(' '));
        currentBlock = [];
      }
      const itemText = trimmed.replace(/^[-*]\s+/, '').trim();
      processedParagraphs.push(`• ${itemText}`);
      continue;
    }

    // Standard body text line - clean inline bold/italics markers for clean editorial typesetting
    const cleanedLine = trimmed
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/_([^_]+)_/g, '$1');

    currentBlock.push(cleanedLine);
  }

  if (currentBlock.length > 0) {
    processedParagraphs.push(currentBlock.join(' '));
  }

  const formattedText = processedParagraphs.join('\n\n');
  const wordCount = formattedText.trim().split(/\s+/).filter(Boolean).length;

  return {
    formattedText,
    detectedStyleId: detectedStyleId || 'style-body',
    wordCount,
  };
}

export async function parseDocxContent(docxBuffer: ArrayBuffer | Uint8Array): Promise<IngestedStory> {
  const files = await readZip(docxBuffer);
  const docXmlBytes = files.get('word/document.xml');

  if (!docXmlBytes) {
    return {
      formattedText: 'Error: Not a valid DOCX document (word/document.xml not found).',
      detectedStyleId: 'style-body',
      wordCount: 0,
    };
  }

  const xml = new TextDecoder().decode(docXmlBytes);
  const pTags = extractXmlTags(xml, 'w:p');
  const paragraphs: string[] = [];
  let detectedStyleId: string | undefined;

  for (const pXml of pTags) {
    // Check paragraph style
    const pStyleVal = extractXmlAttr(pXml, 'w:val');
    if (pStyleVal) {
      if (/heading\s*1/i.test(pStyleVal) && !detectedStyleId) detectedStyleId = 'style-h1';
      else if (/heading\s*2/i.test(pStyleVal) && !detectedStyleId) detectedStyleId = 'style-h2';
      else if (/title/i.test(pStyleVal) && !detectedStyleId) detectedStyleId = 'style-title';
      else if (/quote/i.test(pStyleVal) && !detectedStyleId) detectedStyleId = 'style-pullquote';
    }

    // Extract all text runs <w:t>
    const tTags = extractXmlTags(pXml, 'w:t');
    const runs: string[] = [];
    for (const t of tTags) {
      const text = t.replace(/<w:t[^>]*>/, '').replace(/<\/w:t>/, '');
      runs.push(text);
    }

    const pText = runs.join('').trim();
    if (pText) {
      paragraphs.push(pText);
    }
  }

  const formattedText = paragraphs.join('\n\n');
  const wordCount = formattedText.trim().split(/\s+/).filter(Boolean).length;

  return {
    formattedText,
    detectedStyleId: detectedStyleId || 'style-body',
    wordCount,
  };
}

export async function ingestManuscript(
  fileName: string,
  buffer: ArrayBuffer | Uint8Array
): Promise<IngestedStory> {
  const lowerName = fileName.toLowerCase();

  if (lowerName.endsWith('.docx')) {
    return parseDocxContent(buffer);
  }

  const text = new TextDecoder().decode(buffer);
  if (lowerName.endsWith('.md') || lowerName.endsWith('.markdown')) {
    return parseMarkdownContent(text);
  }

  // Plain text (.txt)
  const paragraphs = text
    .split(/\r?\n\r?\n/)
    .map(p => p.replace(/\r?\n/g, ' ').trim())
    .filter(Boolean);

  const formattedText = paragraphs.join('\n\n');
  const wordCount = formattedText.split(/\s+/).filter(Boolean).length;

  return {
    formattedText,
    detectedStyleId: 'style-body',
    wordCount,
  };
}
