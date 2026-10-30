import type { ProjectState } from '../types';

type Validator = (value: unknown, path: string) => void;
type Schema = Record<string, Validator>;

export class ProjectValidationError extends Error {
  constructor(path: string, problem: string) {
    super(`${path}: ${problem}`);
    this.name = 'ProjectValidationError';
  }
}

function fail(path: string, problem: string): never {
  throw new ProjectValidationError(path, problem);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected an object');
  return value as Record<string, unknown>;
}

const text: Validator = (value, path) => {
  if (typeof value !== 'string') fail(path, 'expected text');
};
const identifier: Validator = (value, path) => {
  text(value, path);
  if (!(value as string).trim()) fail(path, 'ID cannot be empty');
};
const number: Validator = (value, path) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'expected a finite number');
};
const positive: Validator = (value, path) => {
  number(value, path);
  if ((value as number) <= 0) fail(path, 'must be greater than zero');
};
const nonnegative: Validator = (value, path) => {
  number(value, path);
  if ((value as number) < 0) fail(path, 'cannot be negative');
};
const integer: Validator = (value, path) => {
  nonnegative(value, path);
  if (!Number.isInteger(value)) fail(path, 'expected a whole number');
};
const count: Validator = (value, path) => {
  integer(value, path);
  positive(value, path);
};
const boolean: Validator = (value, path) => {
  if (typeof value !== 'boolean') fail(path, 'expected true or false');
};
const choice = (...options: string[]): Validator => (value, path) => {
  if (typeof value !== 'string' || !options.includes(value)) fail(path, `expected one of ${options.join(', ')}`);
};
const optional = (validate: Validator): Validator => (value, path) => {
  if (value !== undefined) validate(value, path);
};
const array = (validate: Validator): Validator => (value, path) => {
  if (!Array.isArray(value)) fail(path, 'expected a list');
  value.forEach((item, index) => validate(item, `${path}[${index}]`));
};
const object = (schema: Schema): Validator => (value, path) => {
  const data = record(value, path);
  for (const [key, validate] of Object.entries(schema)) validate(data[key], `${path}.${key}`);
};
const point = object({ x: number, y: number });
const alignment = choice('left', 'center', 'right', 'justify');
const stroke = { strokeColor: text, strokeWidthMm: nonnegative, strokeDash: choice('solid', 'dashed') };
const typography = { fontFamily: text, fontSizePt: positive };
const grepRule = object({ id: identifier, pattern: text, color: optional(text), bold: optional(boolean), italic: optional(boolean) });
const paragraphStyle = object({
  id: identifier, name: text, ...typography, lineHeight: positive,
  letterSpacingPt: number, color: text, alignment, snapToBaseline: boolean,
  grepStyles: optional(array(grepRule)),
});
const textFormatting = {
  bold: optional(boolean), italic: optional(boolean), underline: optional(boolean),
  fontFamily: optional(text), fontSizePt: optional(positive), color: optional(text),
};
const storyContent: Validator = (value, path) => {
  object({ version: (v, p) => { if (v !== 1) fail(p, 'unsupported story version'); },
    paragraphs: array(object({ styleId: optional(identifier), sourceStyle: optional(text),
      formatting: optional(object({ ...textFormatting, alignment: optional(alignment), lineHeight: optional(positive), letterSpacingPt: optional(number) })),
      runs: array(object({ text, characterStyleId: optional(identifier), ...textFormatting })) })),
  })(value, path);
  if (!(value as { paragraphs: unknown[] }).paragraphs.length) fail(path, 'a story requires at least one paragraph');
};
const elementSchemas: Record<string, Schema> = {
  text: {
    text, ...typography, lineHeight: positive, letterSpacingPt: number,
    color: optional(text), alignment, columns: count, columnGutterMm: nonnegative,
    backgroundColor: text, borderColor: text, borderWidthMm: nonnegative, paddingMm: optional(nonnegative),
    rawStoryText: optional(text), nextFrameId: optional(identifier), prevFrameId: optional(identifier),
    storyContent: optional(storyContent), textContent: optional(storyContent),
    autoExtendStory: optional(boolean), autoPaginationError: optional(text),
    storyStart: optional(integer), storyEnd: optional(integer),
    grepStyles: optional(array(grepRule)),
  },
  image: {
    src: text, fitMode: choice('fill', 'fit', 'frameToContent', 'contentToFrame', 'center', 'stretch'),
    borderColor: text, borderWidthMm: nonnegative, altText: optional(text), proxySrc: optional(text),
  },
  shape: { shapeKind: choice('rectangle', 'ellipse', 'line'), fillColor: text, ...stroke },
  path: {
    nodes: array(object({ x: number, y: number, handleIn: optional(point), handleOut: optional(point) })),
    closed: boolean, fillColor: text, ...stroke,
    strokeCap: choice('butt', 'round', 'square'), strokeJoin: choice('miter', 'round', 'bevel'),
  },
  table: {
    rows: count, cols: count, cells: array(array(object({ text, align: optional(choice('left', 'center', 'right')) }))),
    headerRowCount: integer, headerFillColor: text, headerTextColor: text,
    borderColor: text, borderWidthMm: nonnegative, cellPaddingMm: nonnegative, ...typography,
    rowHeightsMm: optional(array(positive)), colWidthsMm: optional(array(positive)),
  },
};

const element: Validator = (value, path) => {
  const data = record(value, path);
  const type = data.type;
  if (typeof type !== 'string' || !Object.hasOwn(elementSchemas, type)) fail(`${path}.type`, 'unknown element type');
  if (type === 'text') {
    // Older built-in templates relied on these exact renderer fallbacks.
    const legacyLayout = {
      columnGutterMm: 4, backgroundColor: 'transparent',
      borderColor: 'transparent', borderWidthMm: 0,
      letterSpacingPt: 0, alignment: 'left',
    };
    for (const [key, fallback] of Object.entries(legacyLayout)) {
      if (data[key] === undefined) data[key] = fallback;
    }
  }
  object({
    id: identifier, pageId: identifier, x: number, y: number, width: nonnegative,
    height: nonnegative, rotation: number, opacity: nonnegative, zIndex: number, locked: boolean,
    layerId: optional(identifier), ...elementSchemas[type],
    name: optional(text), editorialOnly: optional(boolean),
    textWrap: optional(object({ mode: choice('none', 'boundingBox', 'contour'), standoffMm: nonnegative })),
    anchor: optional(object({ parentTextId: identifier })),
    shadow: optional(object({ color: text, blurMm: nonnegative, offsetX: number, offsetY: number })),
  })(data, path);
  if ((data.opacity as number) > 1) fail(`${path}.opacity`, 'must be between zero and one');
  if (type === 'table') {
    const cells = data.cells as unknown[][];
    if (cells.length !== data.rows || cells.some(row => row.length !== data.cols)) {
      fail(`${path}.cells`, 'cell dimensions must match rows and cols');
    }
  }
};

const page = object({ id: identifier, pageNumber: count, side: choice('left', 'right', 'single'),
  section: optional(object({ title: text, startNumber: count, numbering: choice('arabic', 'roman-lower', 'roman-upper'), prefix: text })) });
const spread = object({ id: identifier, spreadIndex: integer, pages: array(page), elements: array(element) });
const master = object({ id: identifier, name: text, prefix: text, pages: array(page), elements: array(element) });
const layer = object({ id: identifier, name: text, colorHex: text, visible: boolean, locked: boolean, order: number });

/** Validate a detached JSON document; only missing legacy fields receive defaults. */
export function parseProject(json: string, defaults: ProjectState): ProjectState {
  let value: unknown;
  try { value = JSON.parse(json); } catch { fail('Project', 'the file is not valid JSON'); }
  const data = record(value, 'Project');
  const settings = record(data.settings, 'Project.settings');
  // Never turn a missing document or missing page dimensions into a default document.
  object({ title: text, widthMm: positive, heightMm: positive })(settings, 'Project.settings');
  if (!Array.isArray(data.spreads) || data.spreads.length === 0) fail('Project.spreads', 'at least one spread is required');
  const migrated = {
    ...structuredClone(defaults),
    ...data,
    settings: { ...structuredClone(defaults.settings), ...settings },
  };
  object({
    settings: object({
      title: text, widthMm: positive, heightMm: positive,
      preset: choice('A4', 'US-Letter', 'Book-Trade-6x9', 'Digest-5.5x8.5', 'Zine-A5', 'Custom'),
      facingPages: boolean, bleedMm: nonnegative, columnCount: count, columnGutterMm: nonnegative,
      margins: object({ topMm: nonnegative, bottomMm: nonnegative, insideMm: nonnegative, outsideMm: nonnegative }),
      baselineGrid: object({ enabled: boolean, incrementPt: positive, startMm: number }),
      colorMode: optional(choice('cmyk', 'rgb')),
      iccProfile: optional(choice('FOGRA39', 'GRACoL2006', 'SWOP2006', 'sRGB')),
    }),
    spreads: array(spread), masterSpreads: array(master), layers: array(layer),
    embeddedFonts: optional(array(object({ family: identifier, fileName: text, data: text }))),
    paragraphStyles: array(paragraphStyle),
    characterStyles: optional(array(object({ id: identifier, name: text, ...textFormatting }))),
    objectStyles: optional(array(object({ id: identifier, name: text }))),
    conditions: optional(array(object({ id: identifier, name: text, visible: boolean, colorHex: text }))),
    crossReferences: optional(array(object({ id: identifier }))),
    indexEntries: optional(array(object({ id: identifier, topic: text, pageNumber: number }))),
    comments: optional(array(object({ id: identifier, text, author: text, x: number, y: number, spreadIndex: integer, timestamp: number, resolved: boolean }))),
    activeSpreadIndex: integer, selectedElementIds: array(identifier),
    activeTool: choice('select', 'text', 'frame', 'table', 'pen', 'pencil', 'shape-rect', 'shape-ellipse', 'shape-line', 'measure', 'hand', 'zoom'),
    zoom: positive, panX: number, panY: number, showGuides: boolean, showBleed: boolean,
    showBaselineGrid: boolean, snapToGuides: boolean, displayQuality: choice('fast', 'typical', 'high'),
  })(migrated, 'Project');

  const project = migrated as ProjectState;
  if (project.layers.length === 0) fail('Project.layers', 'at least one layer is required');
  const layerIds = new Set(project.layers.map(item => item.id));
  if (layerIds.size !== project.layers.length) fail('Project.layers', 'duplicate layer ID');
  if (!layerIds.has(project.activeLayerId)) project.activeLayerId = project.layers[0].id;
  const spreadIds = new Set<string>();
  const elementIds = new Set<string>();
  for (const [index, current] of [...project.spreads, ...project.masterSpreads].entries()) {
    const location = `Project spreads/masters[${index}]`;
    if (spreadIds.has(current.id)) fail(location, 'duplicate spread ID');
    spreadIds.add(current.id);
    if (current.pages.length === 0) fail(location, 'at least one page is required');
    const pageIds = new Set(current.pages.map(item => item.id));
    if (pageIds.size !== current.pages.length) fail(location, 'duplicate page ID');
    for (const item of current.elements) {
      if (elementIds.has(item.id)) fail(location, `duplicate element ID ${item.id}`);
      elementIds.add(item.id);
      if (!pageIds.has(item.pageId)) {
        // A single-page legacy spread has only one possible owner. Do not guess
        // when multiple pages could own the element.
        if (current.pages.length === 1) item.pageId = current.pages[0].id;
        else fail(location, `element ${item.id} refers to a missing page`);
      }
    }
  }
  // Selection and viewport are session state, so stale references can be repaired.
  const frames = new Map(project.spreads.flatMap(s => s.elements).filter(e => e.type === 'text').map(e => [e.id, e]));
  for (const frame of frames.values()) {
    if (!frame.storyContent && !frame.textContent) continue;
    for (const [pointer, reciprocal] of [['nextFrameId', 'prevFrameId'], ['prevFrameId', 'nextFrameId']] as const) {
      const id = frame[pointer];
      if (id && frames.get(id)?.[reciprocal] !== frame.id) fail(`Story ${frame.id}`, 'broken text-frame link');
    }
    const visited = new Set<string>();
    let current = frame;
    while (current.prevFrameId) {
      if (visited.has(current.id)) fail(`Story ${frame.id}`, 'circular text-frame link');
      visited.add(current.id);
      const previous = frames.get(current.prevFrameId);
      if (!previous) fail(`Story ${frame.id}`, 'missing text frame');
      current = previous;
    }
    if (!current.storyContent) fail(`Story ${frame.id}`, 'the first frame is missing its manuscript');
  }
  project.activeSpreadIndex = Math.min(project.activeSpreadIndex, project.spreads.length - 1);
  const activeIds = new Set(project.spreads[project.activeSpreadIndex].elements.map(item => item.id));
  project.selectedElementIds = project.selectedElementIds.filter(id => activeIds.has(id));
  project.selectedElementId = project.selectedElementIds[0] || null;
  project.zoom = Math.max(0.2, Math.min(3, project.zoom));
  project.linkingFromFrameId = null;
  return project;
}
