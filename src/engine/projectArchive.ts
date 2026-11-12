import type { ProjectState } from '../types';
import { INITIAL_STATE } from '../state/defaults';
import { parseProject } from '../state/projectValidation';
import { createZipArchive, readZip } from '../zip';
import { embeddedAsset, fullImageSource } from '../export/publicationAssets';

const FORMAT = 'recto-project-archive';
// Match the native file picker so a browser export also opens on desktop.
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
const MANIFEST_NAME = 'manifest.json';
const PROJECT_NAME = 'project.recto';
const ZIP_END_BYTES = 22;
const ZIP_END_SIGNATURE = 0x06054b50;

interface ArchiveManifest {
  format: typeof FORMAT;
  version: 1;
  projectBytes: number;
  sha256: string;
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Preserve the editable project and resolve image sources even on unused parent pages. */
export async function createProjectArchive(source: ProjectState): Promise<Blob> {
  const state = structuredClone(source);
  const portableImages = new Map<string, string>();
  for (const spread of [...state.spreads, ...state.masterSpreads]) {
    for (const image of spread.elements) {
      if (image.type !== 'image') continue;
      const original = fullImageSource(image);
      if ((!original && (image.assetId || image.proxySrc)) || (original && !/^data:/i.test(original))) {
        throw new Error(`Embed or relink “${image.name || image.id}” from a local file before saving an editable archive.`);
      }
      // AssetStore can return raw image bytes without an image MIME type.
      if (/^data:application\/octet-stream[;,]/i.test(original)) {
        let resolved = portableImages.get(original);
        if (!resolved) {
          resolved = embeddedAsset(original).dataUrl;
          portableImages.set(original, resolved);
        }
        image.src = resolved;
      } else {
        image.src = original;
      }
      delete image.assetId;
      if (image.proxySrc && !/^data:/i.test(image.proxySrc)) delete image.proxySrc;
    }
  }

  const project = new TextEncoder().encode(JSON.stringify(state));
  if (project.byteLength > MAX_ARCHIVE_BYTES) throw new Error('The editable archive exceeds the 128 MB file limit.');
  const manifest: ArchiveManifest = { format: FORMAT, version: 1, projectBytes: project.byteLength, sha256: await sha256(project) };
  const zip = createZipArchive({ [MANIFEST_NAME]: JSON.stringify(manifest), [PROJECT_NAME]: project });
  if (zip.byteLength > MAX_ARCHIVE_BYTES) throw new Error('The editable archive exceeds the 128 MB file limit.');
  return new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}

export async function readProjectArchive(input: Blob | ArrayBuffer): Promise<ProjectState> {
  const size = input instanceof Blob ? input.size : input.byteLength;
  if (size > MAX_ARCHIVE_BYTES) throw new Error('The editable archive exceeds the 128 MB file limit.');
  const buffer = input instanceof Blob ? await input.arrayBuffer() : input;
  const trailer = new DataView(buffer, Math.max(0, buffer.byteLength - ZIP_END_BYTES));
  if (trailer.byteLength !== ZIP_END_BYTES || trailer.getUint32(0, true) !== ZIP_END_SIGNATURE
    || trailer.getUint16(10, true) !== 2 || trailer.getUint16(20, true) !== 0) {
    throw new Error('The editable project archive is incomplete or invalid.');
  }

  const files = await readZip(buffer, MAX_ARCHIVE_BYTES);
  const manifestBytes = files.get(MANIFEST_NAME);
  const project = files.get(PROJECT_NAME);
  if (files.size !== 2 || !manifestBytes?.length || manifestBytes.length > 4096 || !project?.length) {
    throw new Error('The editable project archive must contain a manifest and project file.');
  }
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let manifest: Partial<ArchiveManifest> | null;
  try {
    manifest = JSON.parse(decoder.decode(manifestBytes));
  } catch {
    throw new Error('The editable project archive manifest is invalid.');
  }
  if (manifest?.format !== FORMAT || manifest.version !== 1) {
    throw new Error('Unsupported editable project archive format or version.');
  }
  // readZip uses the input ArrayBuffer or allocates one when decompressing.
  if (project.byteLength !== manifest.projectBytes || await sha256(project as Uint8Array<ArrayBuffer>) !== manifest.sha256) {
    throw new Error('The editable project archive failed its checksum. Use an intact copy.');
  }
  return parseProject(decoder.decode(project), INITIAL_STATE);
}
