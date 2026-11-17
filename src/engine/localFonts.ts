/**
 * Fonts installed on the user's computer, through the browser's Local Font Access API
 * (`window.queryLocalFonts`, Chrome and Edge). The browser asks the user once for permission;
 * after that a font's file can be read and registered like an imported font file, so it is
 * embedded in the project and in exported PDFs.
 */
import { fontManager } from '../fontManager';

/** One face as the browser reports it (the FontData interface of the API). */
export interface LocalFontFace {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
  blob(): Promise<Blob>;
}

export interface LocalFontFamily {
  family: string;
  /** Regular first, then the other styles. */
  faces: LocalFontFace[];
}

type QueryLocalFonts = () => Promise<LocalFontFace[]>;

const query = (): QueryLocalFonts | undefined =>
  typeof window !== 'undefined' ? (window as unknown as { queryLocalFonts?: QueryLocalFonts }).queryLocalFonts : undefined;

export function localFontsSupported(): boolean {
  return typeof query() === 'function';
}

const STYLE_ORDER = [/^(regular|normal|book|roman|plain|text|standard)$/i, /^(italic|oblique)$/i, /^bold$/i, /^bold ?(italic|oblique)$/i];

function styleRank(style: string): number {
  const index = STYLE_ORDER.findIndex(pattern => pattern.test(style.trim()));
  return index === -1 ? STYLE_ORDER.length : index;
}

/** Group faces into families, regular face first, families in alphabetical order. */
export function groupLocalFonts(faces: LocalFontFace[]): LocalFontFamily[] {
  const families = new Map<string, LocalFontFace[]>();
  for (const face of faces) {
    if (!face.family) continue;
    const list = families.get(face.family) || [];
    list.push(face);
    families.set(face.family, list);
  }
  return [...families].map(([family, list]) => ({
    family,
    faces: list.sort((a, b) => styleRank(a.style) - styleRank(b.style) || a.style.localeCompare(b.style)),
  })).sort((a, b) => a.family.localeCompare(b.family));
}

/** A font name as documents and font files spell it, reduced for comparison. */
export function normalizeFontName(name: string): string {
  return name.split(',')[0].trim().replace(/['"]/g, '').toLocaleLowerCase().replace(/[\s_-]+/g, '');
}

/**
 * The installed face a document font refers to: the regular face of a family of that name, or a
 * face whose full or PostScript name it is (documents imported from InDesign use either).
 */
export function findLocalFont(families: LocalFontFamily[], documentFamily: string): LocalFontFace | null {
  const wanted = normalizeFontName(documentFamily);
  if (!wanted) return null;
  const family = families.find(item => normalizeFontName(item.family) === wanted);
  if (family) return family.faces[0] ?? null;
  for (const item of families) {
    const face = item.faces.find(candidate => normalizeFontName(candidate.fullName) === wanted ||
      normalizeFontName(candidate.postscriptName) === wanted);
    if (face) return face;
  }
  return null;
}

let listing: Promise<LocalFontFamily[]> | undefined;

/** The installed fonts. The first call shows the browser's permission prompt. */
export function listLocalFonts(): Promise<LocalFontFamily[]> {
  const queryFonts = query();
  if (!queryFonts) {
    return Promise.reject(new Error('This browser cannot list the fonts on your computer. Use Chrome or Edge, or import a font file.'));
  }
  const refused = 'Access to the fonts on this computer was not allowed. Click the icon left of the address, allow "Fonts" for this site, and try again, or import the font file instead.';
  listing ??= queryFonts.call(window).then(faces => {
    const families = groupLocalFonts(faces);
    // Chrome answers a refused or dismissed permission with an empty list rather than an error.
    if (!families.length) throw new Error(refused);
    return families;
  }, (reason: unknown) => {
    const name = reason instanceof DOMException ? reason.name : '';
    throw new Error(name === 'NotAllowedError' || name === 'SecurityError' ? refused : 'The fonts on this computer could not be listed. Import the font file instead.');
  }).catch((reason: unknown) => {
    // Not kept: once the user allows access, the next attempt should ask again.
    listing = undefined;
    throw reason;
  });
  return listing;
}

const TTC = [0x74, 0x74, 0x63, 0x66];
const OTTO = [0x4f, 0x54, 0x54, 0x4f];
const startsWith = (bytes: Uint8Array, signature: number[]) => signature.every((byte, index) => bytes[index] === byte);

/** Read an installed face and register it like an imported font file. Returns the family it is registered as. */
export async function loadLocalFont(face: LocalFontFace): Promise<string> {
  const bytes = new Uint8Array(await (await face.blob()).arrayBuffer());
  const name = (face.postscriptName || face.fullName || face.family).replace(/[^\p{L}\p{N}_-]+/gu, '-');
  if (startsWith(bytes, TTC)) {
    // Windows ships some fonts as collections (.ttc): take the face that was chosen out of it.
    const { readFontCollection } = await import('./fontCollection');
    const collection = readFontCollection(bytes, `${name}.ttc`);
    const wanted = [face.fullName, face.postscriptName].map(normalizeFontName);
    const index = Math.max(0, collection.faces.findIndex(candidate => wanted.includes(normalizeFontName(candidate))));
    const extracted = collection.extract(index);
    return fontManager.registerFontBuffer(extracted.fileName, extracted.bytes);
  }
  return fontManager.registerFontBuffer(`${name}${startsWith(bytes, OTTO) ? '.otf' : '.ttf'}`, bytes);
}
