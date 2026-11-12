import type { ProjectState } from '../types';
import { isDesktop, savePublicationFile } from '../desktop';

export type PublicationDownload = 'proof' | 'press' | 'epub' | 'fixed' | 'flipbook' | 'image' | 'package' | 'archive' | 'idml' | 'kit';

export async function downloadPublication(state: ProjectState, action: PublicationDownload) {
  switch (action) {
    case 'proof':
    case 'press': {
      const { exportDocumentToPdf } = await import('../pdfExport');
      const press = action === 'press';
      await exportDocumentToPdf(state, {
        ...(press ? { strict: true } : {}),
        includeCropMarks: press,
        includeBleed: press,
        includeRegistrationMarks: press,
        includeColorBars: press,
        exportFormat: 'pages',
      });
      break;
    }
    case 'epub': {
      const { exportDocumentToEpubAsync } = await import('../epubExport');
      const result = await exportDocumentToEpubAsync(state, { download: !isDesktop(), strict: true });
      if (isDesktop()) await savePublicationFile(result.filename, result.buffer, 'application/epub+zip');
      break;
    }
    case 'fixed': {
      const { exportFixedEpub } = await import('./fixedEpub');
      const name = state.settings.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'publication';
      await savePublicationFile(`${name}-fixed.epub`, await exportFixedEpub(state), 'application/epub+zip');
      break;
    }
    case 'flipbook': {
      const { exportDocumentToFlipbook } = await import('../flipbookExport');
      const result = exportDocumentToFlipbook(state, { download: !isDesktop() });
      if (isDesktop()) await savePublicationFile(result.filename, result.html, 'text/html');
      break;
    }
    case 'image': {
      const canvas = (window as Window & { recto?: { spreadCanvas?: { exportSpreadAsPng?: (scale: number) => string | undefined } } }).recto?.spreadCanvas;
      const dataUrl = canvas?.exportSpreadAsPng?.(3);
      if (!dataUrl) return;
      const title = (state.settings.title || 'recto-spread').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
      const filename = `${title}-spread-${state.activeSpreadIndex + 1}.png`;
      if (isDesktop()) {
        const blob = await (await fetch(dataUrl)).blob();
        await savePublicationFile(filename, blob, 'image/png');
      } else {
        const link = document.createElement('a');
        link.download = filename;
        link.href = dataUrl;
        link.click();
      }
      break;
    }
    case 'package': {
      const { packageDocument } = await import('../packageExport');
      const result = await packageDocument(state, { download: !isDesktop() });
      if (isDesktop()) await savePublicationFile(result.filename, result.buffer, 'application/zip');
      break;
    }
    case 'archive': {
      const { createProjectArchive } = await import('../engine/projectArchive');
      const name = state.settings.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'publication';
      await savePublicationFile(`${name}.rectoarchive`, await createProjectArchive(state));
      break;
    }
    case 'idml':
    case 'kit': {
      const { exportDocumentToIdml } = await import('./idmlExport');
      const idml = exportDocumentToIdml(state);
      const title = (state.settings.title || 'publication').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
      const filename = `${title}.idml`;
      if (action === 'kit') {
        const { createIdmlValidationKit } = await import('./idmlValidationKit');
        await savePublicationFile(`${title}-idml-check.zip`, createIdmlValidationKit(filename, idml), 'application/zip');
      } else await savePublicationFile(filename, idml, 'application/vnd.adobe.indesign-idml-package');
      break;
    }
  }
}
