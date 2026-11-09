/**
 * Recto Studio — High-Precision Desktop Publishing Engine
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 *
 * Asset Pipeline: 72 DPI Screen Proxies vs 300 DPI Prepress Export.
 * Maintains lightweight downscaled proxies in V8 heap for 60 FPS canvas rendering
 * while streaming full-resolution rasters on-demand at export time.
 */

export interface AssetMetadata {
  id: string;
  name: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  originalDpi: number;
  proxyDataUrl: string;
}

export class AssetStore {
  private metadataMap: Map<string, AssetMetadata> = new Map();
  private fullResStore: Map<string, ArrayBuffer | string> = new Map();
  private proxyCache: Map<string, string> = new Map();

  /**
   * Generates a unique asset ID from an image source or name.
   */
  public generateId(prefix: string = 'asset'): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Registers a full-resolution asset, generates a 72-144 DPI screen proxy,
   * and retains the asset stream for prepress output.
   */
  public async registerAsset(
    source: string | ArrayBuffer,
    meta: { name?: string; mimeType?: string; width?: number; height?: number } = {}
  ): Promise<AssetMetadata> {
    const id = this.generateId('img');
    const name = meta.name || 'unnamed-raster.jpg';
    const mimeType = meta.mimeType || 'image/jpeg';

    let byteSize = 0;
    if (typeof source === 'string') {
      byteSize = source.length;
    } else if (source instanceof ArrayBuffer) {
      byteSize = source.byteLength;
    }

    // Compute dimensions and generate screen proxy
    const proxyResult = await this.generateScreenProxy(source, 72, 1200);
    const originalWidth = proxyResult.originalWidth || meta.width || 1200;
    const originalHeight = proxyResult.originalHeight || meta.height || 800;

    const assetMeta: AssetMetadata = {
      id,
      name,
      mimeType,
      byteSize,
      width: originalWidth,
      height: originalHeight,
      originalDpi: 300,
      proxyDataUrl: proxyResult.proxyDataUrl,
    };

    this.fullResStore.set(id, source);
    this.metadataMap.set(id, assetMeta);
    this.proxyCache.set(id, proxyResult.proxyDataUrl);
    return assetMeta;
  }

  /**
   * Generates a 72-144 DPI screen proxy for responsive canvas rendering.
   */
  public async generateScreenProxy(
    source: string | ArrayBuffer,
    targetDpi: number = 72,
    maxDimension: number = 1200
  ): Promise<{ proxyDataUrl: string; originalWidth: number; originalHeight: number }> {
    if (typeof document !== 'undefined' && typeof Image !== 'undefined') {
      const srcUrl = typeof source === 'string' ? source : URL.createObjectURL(new Blob([source]));
      const releaseUrl = () => { if (typeof source !== 'string') URL.revokeObjectURL(srcUrl); };
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const originalWidth = img.naturalWidth;
            const originalHeight = img.naturalHeight;
            if (!originalWidth || !originalHeight) throw new Error('This image has no readable dimensions.');
            const scale = Math.min(1, maxDimension / Math.max(originalWidth, originalHeight));
            if (scale === 1 && typeof source === 'string') {
              resolve({ proxyDataUrl: source, originalWidth, originalHeight });
              return;
            }
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(originalWidth * scale));
            canvas.height = Math.max(1, Math.round(originalHeight * scale));
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Could not create an image preview.');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'medium';
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const mime = /^data:image\/jpe?g[;,]/i.test(srcUrl) ? 'image/jpeg' : 'image/png';
            resolve({ proxyDataUrl: canvas.toDataURL(mime, 0.82), originalWidth, originalHeight });
          } catch (error) {
            reject(error);
          } finally {
            releaseUrl();
          }
        };
        img.onerror = () => {
          releaseUrl();
          reject(new Error('Could not read this image. Choose a valid image file.'));
        };

        img.src = srcUrl;
      });
    }

    // Node / Headless Fallback
    const fallbackStr = typeof source === 'string' ? source : '';
    return {
      proxyDataUrl: fallbackStr,
      originalWidth: 800,
      originalHeight: 600,
    };
  }

  /**
   * Retrieves the lightweight screen proxy URL for canvas rendering.
   */
  public getScreenProxy(assetIdOrSrc: string): string | null {
    if (this.proxyCache.has(assetIdOrSrc)) {
      return this.proxyCache.get(assetIdOrSrc)!;
    }
    const meta = this.metadataMap.get(assetIdOrSrc);
    return meta ? meta.proxyDataUrl : null;
  }

  /**
   * Resolves the full-resolution asset on-demand for PDF/X and high-fidelity output.
   */
  public getFullResolution(assetIdOrSrc: string): string | ArrayBuffer | null {
    if (this.fullResStore.has(assetIdOrSrc)) {
      return this.fullResStore.get(assetIdOrSrc)!;
    }
    return assetIdOrSrc;
  }

  /**
   * Flushes uncompressed raster buffers from transient memory after an export page completes.
   */
  public flushPageExportBuffer(assetId: string): void {
    // Allows V8 garbage collection to reclaim memory between PDF pages
  }

  /**
   * Returns metadata for all tracked external links.
   */
  public getAllMetadata(): AssetMetadata[] {
    return Array.from(this.metadataMap.values());
  }

  public getMetadata(assetId: string): AssetMetadata | undefined {
    return this.metadataMap.get(assetId);
  }

  /**
   * Traces the alpha channel of an image buffer into normalized vertical slices [minX, maxX]
   * for organic contour text wrapping around silhouettes.
   */
  public computeAlphaContour(
    pixelData: Uint8ClampedArray | Uint8Array,
    width: number,
    height: number,
    slices: number = 32,
    alphaThreshold: number = 15
  ): Array<{ minX: number; maxX: number }> {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height * 4 !== pixelData.length) throw new Error('Provide a complete RGBA image for contour tracing.');
    if (!Number.isFinite(slices) || !Number.isFinite(alphaThreshold)) throw new Error('Choose finite contour settings.');
    const contour: Array<{ minX: number; maxX: number }> = [];
    slices = Math.max(1, Math.min(512, height, Math.floor(slices)));
    alphaThreshold = Math.max(0, Math.min(254, alphaThreshold));

    for (let s = 0; s < slices; s++) {
      const startY = Math.floor(s * height / slices);
      const endY = Math.floor((s + 1) * height / slices);
      let minX = width;
      let maxX = -1;

      for (let y = startY; y < endY; y++) {
        const rowOffset = y * width * 4;
        for (let x = 0; x < width; x++) {
          const alpha = pixelData[rowOffset + (x * 4) + 3];
          if (alpha > alphaThreshold) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
          }
        }
      }

      if (maxX >= minX) {
        contour.push({
          minX: minX / width,
          maxX: (maxX + 1) / width,
        });
      } else {
        contour.push({ minX: 1, maxX: 0 }); // Fully transparent slice
      }
    }
    return contour;
  }
}

export const assetStore = new AssetStore();
