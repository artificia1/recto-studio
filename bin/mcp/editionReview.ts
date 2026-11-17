import { classifyProofPage, matchProofPages, type ProofPage } from '../../src/engine/proofComparison';
import { pdfExportPayload } from '../../src/export/pdfPayload';
import { limits, sha256, type PublishingWorkspace } from './workspace';
import { openProof, visualDiff } from './proof';
import { withPublication, type LoadedProject } from './publication';

function proofPages(project: LoadedProject) {
  const pages = project.source.spreads.flatMap((spread, spreadIndex) =>
    spread.pages.map(page => ({ id: page.id, number: page.pageNumber, spreadIndex })));
  if (new Set(pages.map(page => page.id)).size !== pages.length) {
    throw new Error('Page IDs must be unique to compare the stages of a publication.');
  }
  return pages;
}

async function projectProof(project: LoadedProject, physicalPages: number[]) {
  if (!physicalPages.length) return undefined;
  const pages = proofPages(project);
  const wanted = new Set(physicalPages);
  const spreads = new Set(physicalPages.map(index => pages[index].spreadIndex));
  const indices = new Map<number, number>();
  let rendered = 0;
  pages.forEach((page, index) => {
    if (!spreads.has(page.spreadIndex)) return;
    if (wanted.has(index)) indices.set(index, rendered);
    rendered++;
  });
  if (rendered > 48) throw new Error('Reduce the review limit to include at most 48 rendered pages.');
  const warnings = new Set<string>();
  const { exportDocumentToPdf } = await import('../../src/export/pdfExport');
  const pdf = await withPublication(project, source => exportDocumentToPdf(source, {
    spreadRange: [...spreads], fetchExternalAssets: false, download: false, visualProof: true,
    overprintBlack: false, onWarning: warning => warnings.add(warning),
  }));
  const payload = pdfExportPayload(pdf);
  if (payload.size > limits.pdf) throw new Error('The review exceeds the intermediate PDF size limit. Reduce the review limit.');
  const renderer = await openProof(payload);
  if (renderer.length !== rendered) {
    await renderer.destroy();
    throw new Error('The preview PDF does not match the selected publication pages.');
  }
  return { renderer, indices, warnings: [...warnings].slice(0, 30) };
}

export async function reviewPublicationChange(before: LoadedProject, after: LoadedProject, offset: number, limit: number, preview: boolean) {
  const originals = proofPages(before), current = proofPages(after);
  const previousById = new Map(originals.map((page, i) => [page.id, i]));
  const retained = new Set(current.map(page => page.id));
  const pairs = [
    ...current.map((page, index) => ({ id: page.id, before: previousById.get(page.id) ?? null, after: index as number | null })),
    ...originals.flatMap((page, index) => retained.has(page.id) ? [] : [{ id: page.id, before: index as number | null, after: null }]),
  ];
  const selection = pairs.slice(offset, offset + limit);
  const oldProof = await projectProof(before, selection.flatMap(row => row.before === null ? [] : [row.before]));
  let newProof: Awaited<ReturnType<typeof projectProof>>;
  try {
    newProof = await projectProof(after, selection.flatMap(row => row.after === null ? [] : [row.after]));
    async function signatures(proof: Awaited<ReturnType<typeof projectProof>>) {
      if (!proof) return new Map<number, ProofPage>();
      const pageIndices = [...proof.indices.values()];
      const scanned = await proof.renderer.scan(pageIndices);
      return new Map([...proof.indices.keys()].map((physical, i) => [physical, scanned[i]]));
    }
    const old = await signatures(oldProof), revised = await signatures(newProof);
    const rows = selection.map(row => {
      const a = row.before === null ? undefined : old.get(row.before);
      const b = row.after === null ? undefined : revised.get(row.after);
      const change = a && b ? classifyProofPage(a, b) : a ? 'removed' : 'added';
      return { id: row.id, change, moved: row.before !== null && row.after !== null && row.before !== row.after,
        before: row.before === null ? null : { physical: row.before + 1, label: originals[row.before].number },
        after: row.after === null ? null : { physical: row.after + 1, label: current[row.after].number } };
    });
    const changed = preview && rows.findIndex(row => row.change !== 'unchanged' || row.moved);
    let image: Buffer | undefined, previewKind: 'diff' | 'before' | 'after' | undefined;
    if (typeof changed === 'number' && changed >= 0) {
      const pair = selection[changed];
      const a = pair.before === null ? undefined : await oldProof!.renderer.png([oldProof!.indices.get(pair.before)!], 960);
      const b = pair.after === null ? undefined : await newProof!.renderer.png([newProof!.indices.get(pair.after)!], 960);
      if (a && b) {
        const diff = await visualDiff(a, b);
        image = diff.comparable ? diff.bytes : b.bytes;
        previewKind = diff.comparable ? 'diff' : 'after';
      } else {
        image = (b || a)?.bytes;
        previewKind = b ? 'after' : 'before';
      }
    }
    const hasPreview = !!image && image.length <= limits.proofImage;
    return { image: hasPreview ? image : undefined, report: {
      revision: before.revision, pages: rows, total: pairs.length, nextOffset: offset + limit < pairs.length ? offset + limit : null,
      beforePageCount: originals.length, afterPageCount: current.length,
      preview: hasPreview && typeof changed === 'number' ? { kind: previewKind, pageId: rows[changed].id } : null,
      warnings: { before: oldProof?.warnings ?? [], after: newProof?.warnings ?? [] },
    } };
  } finally {
    await Promise.allSettled([oldProof?.renderer.destroy(), newProof?.renderer.destroy()]);
  }
}

export async function reviewPdfEditions(workspace: PublishingWorkspace, before: string, after: string, offset: number, limit: number) {
  async function scanEdition(filename: string, pageBudget: number) {
    const bytes = await workspace.read(filename, ['.pdf'], limits.pdf);
    const revision = sha256(bytes);
    const proof = await openProof(bytes);
    try {
      if (proof.length > pageBudget) throw new Error('Edition matching supports up to 200 pages across the two PDFs.');
      return { revision, pages: await proof.scan() };
    } finally { await proof.destroy(); }
  }
  const original = await scanEdition(before, 200);
  const revised = await scanEdition(after, 200 - original.pages.length);
  const matches = matchProofPages(original.pages, revised.pages);
  const pages = matches.slice(offset, offset + limit).map(row => ({
    ...row, before: row.before === null ? null : row.before + 1, after: row.after === null ? null : row.after + 1,
  }));
  return { total: matches.length, nextOffset: offset + limit < matches.length ? offset + limit : null,
    beforePageCount: original.pages.length, afterPageCount: revised.pages.length,
    beforeSha256: original.revision, afterSha256: revised.revision, pages };
}
