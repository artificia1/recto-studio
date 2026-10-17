/**
 * Recto Studio — High-Precision Desktop Publishing Engine
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 */

/**
 * Complex Script & OpenType Shaper (HarfBuzz WASM):
 * Bridges HarfBuzz WebAssembly engine for full OpenType feature execution,
 * bidirectional Arabic cursive joining, and Indic / Devanagari consonant conjunct reordering.
 */

export interface ShapedGlyph {
  glyphId: number;
  cluster: number;
  xOffset: number;
  yOffset: number;
  xAdvance: number;
  yAdvance: number;
  svgPath: string;
}

export interface ShapingResult {
  glyphs: ShapedGlyph[];
  totalAdvance: number;
  direction: 'ltr' | 'rtl';
  script: string;
}

export interface ShapeOptions {
  features?: { tag: string; value: number }[];
  script?: string;
  language?: string;
  direction?: 'ltr' | 'rtl';
}

class HarfBuzzShapingEngine {
  private hbModule: any = null;
  private fontCache: Map<ArrayBuffer | Uint8Array, { face: any; font: any }> = new Map();
  private pathCache: Map<string, Path2D> = new Map();

  /**
   * Asynchronously initializes and caches the HarfBuzz WASM module.
   */
  public async getHarfBuzz(): Promise<any> {
    if (!this.hbModule) {
      this.hbModule = await import('harfbuzzjs');
    }
    return this.hbModule;
  }

  /**
   * Creates or retrieves a cached HarfBuzz font instance from a binary TTF/OTF buffer.
   */
  public async getFont(fontBuffer: ArrayBuffer | Uint8Array): Promise<{ face: any; font: any }> {
    let cached = this.fontCache.get(fontBuffer);
    if (!cached) {
      const hb = await this.getHarfBuzz();
      const buffer = fontBuffer instanceof Uint8Array ? fontBuffer.buffer : fontBuffer;
      const blob = new hb.Blob(buffer);
      const face = new hb.Face(blob);
      const font = new hb.Font(face);
      cached = { face, font };
      this.fontCache.set(fontBuffer, cached);
    }
    return cached;
  }

  /**
   * Shapes arbitrary Unicode text with HarfBuzz, returning exact positioned glyphs and SVG outline vectors.
   */
  public async shape(
    fontBuffer: ArrayBuffer | Uint8Array,
    text: string,
    options: ShapeOptions = {}
  ): Promise<ShapingResult> {
    const hb = await this.getHarfBuzz();
    const { font } = await this.getFont(fontBuffer);
    const buffer = new hb.Buffer();

    buffer.addText(text);
    buffer.guessSegmentProperties();

    if (options.direction) {
      buffer.setDirection(options.direction === 'rtl' ? hb.Direction.RTL : hb.Direction.LTR);
    }
    if (options.script) {
      buffer.setScript(hb.otTagToScript(options.script));
    }
    if (options.language) {
      buffer.setLanguage(hb.otTagToLanguage(options.language));
    }

    const hbFeatures: any[] = [];
    if (options.features) {
      for (const feat of options.features) {
        hbFeatures.push(new hb.Feature(feat.tag, feat.value));
      }
    }

    hb.shape(font, buffer, hbFeatures);

    const infos = buffer.getGlyphInfos();
    const positions = buffer.getGlyphPositions();
    const shapedGlyphs: ShapedGlyph[] = [];
    let totalAdvance = 0;

    for (let i = 0; i < infos.length; i++) {
      const info = infos[i];
      const pos = positions[i];
      const gid = info.codepoint;
      const svgPath = font.glyphToPath(gid) || '';

      shapedGlyphs.push({
        glyphId: gid,
        cluster: info.cluster,
        xOffset: pos.xOffset,
        yOffset: pos.yOffset,
        xAdvance: pos.xAdvance,
        yAdvance: pos.yAdvance,
        svgPath,
      });

      totalAdvance += pos.xAdvance;
    }

    const isRtl = options.direction === 'rtl' || /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/.test(text);

    return {
      glyphs: shapedGlyphs,
      totalAdvance,
      direction: isRtl ? 'rtl' : 'ltr',
      script: options.script || (isRtl ? 'Arab' : 'Latn'),
    };
  }

  /**
   * Renders shaped glyphs to an HTML5 Canvas2D context with subpixel precision and Path2D caching.
   */
  public async renderToCanvas(
    ctx: CanvasRenderingContext2D,
    result: ShapingResult,
    fontBuffer: ArrayBuffer | Uint8Array,
    x: number,
    y: number,
    fontSizePt: number,
    color: string = '#000000'
  ): Promise<void> {
    const { face } = await this.getFont(fontBuffer);
    const upem = face.upem || 1000;
    const scale = (fontSizePt * (96 / 72)) / upem;

    ctx.save();
    ctx.fillStyle = color;

    let curX = x;

    for (const glyph of result.glyphs) {
      if (glyph.svgPath) {
        let path = this.pathCache.get(glyph.svgPath);
        if (!path) {
          path = new Path2D(glyph.svgPath);
          this.pathCache.set(glyph.svgPath, path);
        }

        const glyphX = curX + (glyph.xOffset * scale);
        const glyphY = y - (glyph.yOffset * scale);

        ctx.save();
        ctx.translate(glyphX, glyphY);
        ctx.scale(scale, -scale);
        ctx.fill(path);
        ctx.restore();
      }

      curX += glyph.xAdvance * scale;
    }

    ctx.restore();
  }
}

export const harfbuzzEngine = new HarfBuzzShapingEngine();
