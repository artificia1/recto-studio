import type { ProjectState } from '../../src/types';
import { parseMergeData, substituteElementTokens, substituteTokens } from '../../src/dataMerge';
import { embeddedAsset } from '../../src/export/publicationAssets';
import { PDF_PRESETS, type PdfPreset } from '../../src/export/presets';
import { limits, sha256, type PublishingWorkspace } from './workspace';
import { composedPreflight, confirmProjectRevision, summarizeIssues, type LoadedProject } from './publication';
import { publicationSnapshot } from '../../src/engine/publicationReferences';

export async function compilePdf(project: ProjectState, preset: PdfPreset) {
  const warnings = new Set<string>();
  const { exportDocumentToPdf } = await import('../../src/export/pdfExport');
  const pdf = await exportDocumentToPdf(project, { ...PDF_PRESETS[preset].options, strict: true,
    download: false, fetchExternalAssets: false, onWarning: warning => warnings.add(warning) });
  const bytes = Buffer.from(pdf.output('arraybuffer'));
  if (bytes.length > limits.pdf) throw new Error('The PDF exceeds 64 MiB. Use a smaller publication.');
  return { bytes, pages: pdf.getNumberOfPages(), warnings: [...warnings].slice(0, 50),
    preset, description: PDF_PRESETS[preset].description };
}

export async function compilePublication(project: ProjectState, format: 'epub' | 'fixed-epub' | 'idml' | 'xliff', targetLanguage?: string) {
  let bytes: Uint8Array;
  let warnings: string[] = [];
  if (format === 'xliff') {
    if (!targetLanguage) throw new Error('Choose a target language for XLIFF export.');
    const { translationCatalog } = await import('../../src/translation/catalog');
    const { writeTranslationExchange } = await import('../../src/translation/xliff');
    bytes = Buffer.from(writeTranslationExchange(translationCatalog(project).filter(group => !group.restricted),
      project.settings.language || 'en', targetLanguage));
  } else if (format === 'idml') {
    const { exportDocumentToIdml } = await import('../../src/export/idmlExport');
    bytes = exportDocumentToIdml(project);
    warnings = ['IDML covers supported interchange features. Review the result in InDesign before handoff.'];
  } else if (format === 'fixed-epub') {
    const { exportFixedEpub } = await import('../../src/export/fixedEpub');
    bytes = await exportFixedEpub(project);
    warnings = ['Review the fixed-layout edition in your target EPUB reader.'];
  } else {
    const { exportDocumentToEpubAsync } = await import('../../src/epubExport');
    const result = await exportDocumentToEpubAsync(project, { download: false, strict: true });
    bytes = new Uint8Array(result.buffer);
    warnings = result.warnings;
  }
  if (bytes.byteLength > limits.pdf) throw new Error('The export exceeds 64 MiB. Use a smaller publication.');
  return { bytes, warnings: warnings.slice(0, 50) };
}

export function preflightReport(project: ProjectState, preset: PdfPreset, offset: number, limit: number) {
  const state = publicationSnapshot(project);
  const issues = composedPreflight(state, 'print');
  const settings = state.settings;
  const prerequisites: string[] = [];
  if (['flattened', 'pdfx1a', 'pdfx4'].includes(preset) && !settings.colorManagement?.outputProfile) {
    prerequisites.push('Import a CMYK output ICC profile for this preset.');
  }
  const linked = issues.filter(issue => issue.code === 'EXTERNAL_ASSET').length;
  if (linked) prerequisites.push('Embed linked images before exporting with the local publishing server.');
  return { ...summarizeIssues(issues, offset, limit), preset, description: PDF_PRESETS[preset].description, prerequisites };
}

export async function renderDataset(workspace: PublishingWorkspace, project: LoadedProject, dataset: string,
  output: string, preset: PdfPreset, photoFields: string[]) {
  await workspace.checkOutput(output);
  const dataBytes = await workspace.read(dataset, ['.csv', '.json'], limits.dataset);
  const datasetRevision = sha256(dataBytes);
  const data = parseMergeData(dataBytes.toString('utf8'));
  const template = project.source;
  if (!data.records.length || data.records.length > limits.records) throw new Error('Render between 1 and 100 records per batch.');
  for (const key of photoFields) if (!data.headers.includes(key)) throw new Error(`The dataset has no “${key}” photo column.`);
  if (data.records.length * template.spreads.reduce((pages, spread) => pages + spread.pages.length, 0) > limits.pages) {
    throw new Error('Split the batch into at most 500 output pages.');
  }
  const outputFiles: { name: string; bytes: Uint8Array }[] = [];
  const results: { name: string; pages: number; warnings: string[] }[] = [];
  let total = 0;
  for (const [index, record] of data.records.entries()) {
    try {
      const photos: Record<string, string> = Object.create(null);
      for (const key of photoFields) {
        const file = record[key];
        if (!file) throw new Error(`The “${key}” column needs a local photo path.`);
        const bytes = await workspace.read(file, ['.png', '.jpg', '.jpeg', '.webp', '.gif'], limits.image);
        photos[key] = embeddedAsset(`data:application/octet-stream;base64,${bytes.toString('base64')}`).dataUrl;
      }
      const merged = structuredClone(template);
      merged.settings.title = substituteTokens(merged.settings.title, record);
      for (const spread of [...merged.spreads, ...merged.masterSpreads]) {
        spread.elements = spread.elements.map(element => substituteElementTokens(element,
          element.type === 'image' ? { ...record, ...photos } : record));
      }
      const compilation = await compilePdf(merged, preset);
      total += compilation.bytes.length;
      if (total > limits.batch) throw new Error('The batch exceeds 128 MiB. Split the dataset into smaller batches.');
      const name = `record-${String(index + 1).padStart(4, '0')}.pdf`;
      outputFiles.push({ name, bytes: compilation.bytes });
      results.push({ name, pages: compilation.pages, warnings: compilation.warnings });
    } catch (error) {
      throw new Error(`Record ${index + 1} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await confirmProjectRevision(workspace, project.file, project.revision);
  if (sha256(await workspace.read(dataset, ['.csv', '.json'], limits.dataset)) !== datasetRevision) {
    throw new Error('The dataset changed during export. Run the batch again.');
  }
  outputFiles.push({ name: 'manifest.json', bytes: Buffer.from(JSON.stringify({ preset, sourceRevision: project.revision,
    datasetRevision, records: results }, null, 2)) });
  const files = await workspace.writeBatch(output, outputFiles);
  return { preset, records: results.length, files };
}
