import type { ImageAdjustments } from '../types';

type Source = HTMLImageElement | HTMLCanvasElement;
type Preview = HTMLCanvasElement | ImageBitmap;

interface Entry {
  source: Source;
  settings: ImageAdjustments;
  key: string;
  pixels: number;
  frame: number;
  preview?: Preview | null;
}

function release(preview?: Preview | null) {
  if (!preview) return;
  if (preview instanceof HTMLCanvasElement) preview.width = preview.height = 0;
  else preview.close();
}

/** Holds at most one adjusted preview per displayed frame and runs one adjustment at a time. */
export class AdjustmentPreviewCache {
  private readonly entries = new Map<string, Entry>();
  private active?: { entry: Entry; controller: AbortController };
  private frame = 0;
  private pixels = 0;

  constructor(private readonly redraw: () => void) {}

  beginFrame(adjustedFrames: number) {
    this.frame++;
    // Divide a 24 MiB RGBA budget across this spread. A single image gets at most 4 MiB.
    this.pixels = Math.max(1, Math.min(1_048_576, Math.floor(6_291_456 / Math.max(1, adjustedFrames))));
  }

  get(id: string, source: Source, settings: ImageAdjustments): Source | Preview {
    const key = JSON.stringify(settings);
    let entry = this.entries.get(id);
    if (!entry || entry.source !== source || entry.key !== key || entry.pixels !== this.pixels) {
      if (entry) this.discard(id, entry);
      entry = { source, settings, key, pixels: this.pixels, frame: this.frame };
      this.entries.set(id, entry);
    }
    entry.frame = this.frame;
    return entry.preview ?? source;
  }

  endFrame() {
    for (const [id, entry] of this.entries) if (entry.frame !== this.frame) this.discard(id, entry);
    this.pump();
  }

  clear() {
    for (const [id, entry] of this.entries) this.discard(id, entry);
  }

  private discard(id: string, entry: Entry) {
    if (this.active?.entry === entry) this.active.controller.abort();
    release(entry.preview);
    this.entries.delete(id);
  }

  private pump() {
    if (this.active) return;
    const next = Array.from(this.entries).find(([, entry]) => entry.preview === undefined);
    if (!next) return;
    const [id, entry] = next;
    const controller = new AbortController();
    this.active = { entry, controller };
    void import('./imageAdjustmentPreview').then(({ renderAdjustmentPreview }) =>
      renderAdjustmentPreview(entry.source, entry.settings, entry.pixels, controller.signal),
    ).then(preview => {
      if (this.entries.get(id) !== entry) { release(preview); return; }
      entry.preview = preview;
      if (preview) this.redraw();
    }).catch(() => { entry.preview = null; })
      .finally(() => {
        this.active = undefined;
        this.pump();
      });
  }
}
