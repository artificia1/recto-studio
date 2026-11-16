import { parseDocxContent, parseMarkdownContent } from '../src/contentImport';
import { composeManuscript } from '../src/engine/manuscriptCompilation';
import { fontManager } from '../src/fontManager';
import { pdfExportPayload, pdfSha256 } from '../src/export/pdfPayload';
import { PDF_PRESETS } from '../src/export/presets';
import { loadPdfChunks } from '../src/export/pdfChunkReader';
import { loadProject } from './mcp/publication';
import { buildProof, visualDiff } from './mcp/proof';
import { limits, PublishingWorkspace, sha256 } from './mcp/workspace';

import { publicationRecipe, type PublicationPlan, type PublicationRecipe } from './publicationRecipe';

const encoder = new TextEncoder();

type Layout = ReturnType<typeof composeManuscript>;

async function withManuscriptLayout<T>(workspace: PublishingWorkspace, args: PublicationPlan, run: (layout: Layout, report: {
  title: string; sourceRevision: string; resourceRevision?: string; words: number; fontFamily: string; warnings: string[];
}) => Promise<T>) {
  const source = await workspace.read(args.manuscript, ['.md', '.docx'], limits.exchange);
  const sourceRevision = sha256(source);
  const manuscript = args.manuscript.toLowerCase().endsWith('.docx')
    ? await parseDocxContent(source)
    : parseMarkdownContent(new TextDecoder('utf-8', { fatal: true }).decode(source));
  const resources = args.printResources ? await loadProject(workspace, args.printResources) : undefined;
  const fonts = resources?.source.embeddedFonts ?? [];
  const requestedFont = args.fontFamily || fonts[0]?.family || 'Times';
  if (requestedFont !== 'Times' && !fonts.some(font => font.family === requestedFont)) {
    throw new Error('Choose Times or an exact embedded font family from printResources.');
  }
  if (args.pdfPreset.startsWith('pdfx') &&
      (!resources?.source.settings.colorManagement?.convertPdf || !fonts.some(font => font.family === requestedFont))) {
    throw new Error('PDF/X candidates require a Recto printResources project with an output ICC profile and the selected embedded font.');
  }
  const language = Intl.getCanonicalLocales(args.language)[0];
  const heading = manuscript.content?.paragraphs.find(paragraph => paragraph.styleId === 'style-h1' || paragraph.styleId === 'style-title');
  const title = args.title || heading?.runs.map(run => run.text).join('').trim().slice(0, 200)
    || args.manuscript.split('/').at(-1)!.replace(/\.(?:md|docx)$/i, '').slice(0, 200);
  const { pdfStoryMeasure } = await import('../src/export/pdfExport');

  return fontManager.withProjectFonts(fonts, async () => {
    const layout = composeManuscript(manuscript, {
      trim: args.preset, title, author: args.author, fontFamily: requestedFont, language, sourceRevision,
      pagesPerSignature: args.pagesPerSignature, exactSignatures: args.targetSignatures,
      resources: { embeddedFonts: fonts, colorManagement: resources?.source.settings.colorManagement },
    }, pdfStoryMeasure());
    return run(layout, { title, sourceRevision, resourceRevision: resources?.revision,
      words: manuscript.wordCount, fontFamily: requestedFont, warnings: manuscript.warnings ?? [] });
  });
}

export function planPublication(workspace: PublishingWorkspace, args: PublicationPlan) {
  return withManuscriptLayout(workspace, args, async ({ state, budget, headings }, source) => ({
    ...source, budget, trimMm: [state.settings.widthMm, state.settings.heightMm],
    headings: headings.slice(0, 50).map(({ title, level, pageNumber }) => ({ title, level, pageNumber })),
    headingCount: headings.length, spine: estimateSpine(args, budget.deliveredPages),
    outputPreset: args.pdfPreset, printerApprovalRequired: true,
  }));
}

function estimateSpine(args: PublicationPlan, pages: number) {
  return args.paperSpec ? { paper: args.paperSpec, leaves: pages / 2,
    textBlockMm: Number((pages / 2 * args.paperSpec.caliperMm).toFixed(3)) } : null;
}

export async function compilePublication(workspace: PublishingWorkspace, args: PublicationRecipe) {
  await workspace.checkOutput(args.output);
  if (args.sheetProof && !args.pagesPerSignature) throw new Error('Set pages per signature before exporting a sheet proof.');
  const baseline = args.previousPdf ? await workspace.read(args.previousPdf, ['.pdf'], limits.pdf) : undefined;
  const { exportDocumentToPdf } = await import('../src/export/pdfExport');
  return withManuscriptLayout(workspace, args, async ({ state, budget, headings }, source) => {
    const warnings = new Set(source.warnings);
    if (args.proofPage > budget.manuscriptPages) throw new Error('Choose a proof page containing manuscript content.');
    const pdf = await exportDocumentToPdf(state, {
      ...PDF_PRESETS[args.pdfPreset].options, strict: true, download: false, fetchExternalAssets: false,
      includeSlugText: false,
      onWarning: warning => warnings.add(warning),
    });
    const payload = pdfExportPayload(pdf);
    if (payload.size > limits.pdf) throw new Error('The compiled PDF exceeds the 64 MiB output limit.');
    const checked = await loadPdfChunks(payload, true);
    if (checked.getPageCount() !== budget.deliveredPages) throw new Error('The compiled PDF page count does not match its publication plan.');

    const proof = await buildProof(payload, args.proofPage);
    const files: Parameters<PublishingWorkspace['writeBatch']>[1] = [
      { name: 'interior.pdf', bytes: payload.parts() },
      { name: 'edition.recto', bytes: encoder.encode(JSON.stringify(state)) },
      { name: 'proof.png', bytes: proof.bytes },
    ];
    let comparison;
    if (baseline) {
      const before = await buildProof(baseline, args.proofPage);
      files.push({ name: 'proof-before.png', bytes: before.bytes });
      const diff = await visualDiff(before, proof);
      if (diff.comparable) files.push({ name: 'proof-diff.png', bytes: diff.bytes });
      comparison = { comparable: diff.comparable, changedPixels: diff.comparable ? diff.changedPixels : null, previousRevision: sha256(baseline) };
    }
    const imposition = args.pagesPerSignature ? (await import('../src/export/impositionEngine')).calculateImpositionPlan({
      ...state, spreads: state.spreads.map(spread => ({
        ...spread, pages: spread.pages.filter(page => page.pageNumber <= budget.manuscriptPages),
      })),
    }, {
      bindingMode: 'perfect-bound', signatureSize: args.pagesPerSignature, creepMmPerSheet: 0,
    }) : undefined;
    if (imposition) files.push({
      name: 'signature-plan.json',
      bytes: encoder.encode(JSON.stringify({
        ...budget, widthMm: imposition.sheetWidthMm, heightMm: imposition.sheetHeightMm,
        sheetSides: imposition.sheetSides, requiresPrinterSheetAndCreepApproval: true,
      }, null, 2)),
    });
    if (args.sheetProof && imposition) {
      const { exportSignatureSheetProof } = await import('../src/export/signatureSheetProof');
      const sheetProof = await exportSignatureSheetProof(checked, imposition);
      if (sheetProof.size > limits.pdf) throw new Error('The imposed sheet proof exceeds the 64 MiB output limit.');
      files.push({ name: 'signature-sheets-proof.pdf', bytes: sheetProof.parts() });
    }
    const report = {
      ...source,
      proofPage: args.proofPage, comparison, pageBudget: budget,
      trimMm: [state.settings.widthMm, state.settings.heightMm],
      spine: estimateSpine(args, budget.deliveredPages),
      headings: headings.map(({ title, level, pageNumber }) => ({ title, level, pageNumber })),
      outputPreset: args.pdfPreset, checks: ['Strict Recto export', 'Reparsed PDF page count matches the edition'],
      printerApprovalRequired: true, independentlyCertified: false, warnings: [...warnings],
    };
    files.push({ name: 'report.json', bytes: encoder.encode(JSON.stringify(report, null, 2)) });
    files.push({ name: 'printer-handoff.json', bytes: encoder.encode(JSON.stringify({
      title: report.title, author: state.settings.author, trimMm: report.trimMm,
      interior: { file: 'interior.pdf', sha256: await pdfSha256(payload), pages: budget.deliveredPages, order: 'reader' },
      trailingBlankPages: budget.blankPages, pagesPerSignature: budget.signatureSize, spine: report.spine,
      requestedPdfPreset: args.pdfPreset, independentValidation: 'pending',
      review: ['Confirm cover template and binding allowances', 'Confirm paper caliper and sheet plan with the printer',
        'Validate the exact interior PDF against the printer requirements', 'Inspect a manufactured proof before production'],
    }, null, 2)) });
    const size = files.reduce((total, file) => total + (file.bytes instanceof Uint8Array ? file.bytes.byteLength
      : file.bytes.reduce((sum, chunk) => sum + chunk.byteLength, 0)), 0);
    if (size > limits.batch) throw new Error('The edition package exceeds 128 MiB.');
    if (sha256(await workspace.read(args.manuscript, ['.md', '.docx'], limits.exchange)) !== source.sourceRevision) {
      throw new Error('The manuscript changed during compilation. Run the compiler again.');
    }
    const outputs = await workspace.writeBatch(args.output, files);
    return { report, outputs, preview: proof.bytes };
  });
}

export async function runCompileCommand(args: string[]) {
  const { parseArgs } = await import('node:util');
  const parsed = parseArgs({ args, allowPositionals: true, options: { workspace: { type: 'string' } } });
  if (parsed.positionals.length !== 1) throw new Error('Usage: recto compile <recipe.json> [--workspace <folder>]');
  const workspace = await PublishingWorkspace.open(parsed.values.workspace || process.cwd(), true);
  const bytes = await workspace.read(parsed.positionals[0], ['.json'], 64 * 1024);
  const { report, outputs } = await compilePublication(workspace, publicationRecipe.parse(JSON.parse(bytes.toString('utf8'))));
  console.log(JSON.stringify({ report, outputs }, null, 2));
}
