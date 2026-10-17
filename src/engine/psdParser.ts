/**
 * Recto Studio — High-Precision Desktop Publishing Engine
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 */

import { readPsd, initializeCanvas } from 'ag-psd';

/**
 * Native Adobe Photoshop (.psd / .psb) Binary Parsing Engine:
 * Ingests multi-layer Photoshop files in-memory without manual flat rasterization.
 * Extracts layer hierarchy, names, blend modes, bounds, and renders selective layer composites.
 */

export interface PsdLayerItem {
  id: number;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode?: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  canvas?: any;
}

export interface PsdDocumentData {
  width: number;
  height: number;
  channels: number;
  colorMode: string;
  layers: PsdLayerItem[];
  compositeDataUrl?: string;
  rawBuffer?: ArrayBuffer | Uint8Array;
}

export class PsdEngine {
  /**
   * Parses an in-memory PSD/PSB binary buffer into an inspection-ready layer tree.
   */
  public parse(
    buffer: ArrayBuffer | Uint8Array,
    options: { skipImageData?: boolean } = {}
  ): PsdDocumentData {
    const isBrowser = typeof document !== 'undefined' && typeof document.createElement === 'function';
    const skipImages = options.skipImageData ?? !isBrowser;

    const psd = readPsd(buffer, {
      skipCompositeImageData: skipImages,
      skipLayerImageData: skipImages,
      skipThumbnail: true,
    });

    const layers: PsdLayerItem[] = [];
    let layerCounter = 0;

    const traverse = (children: any[]) => {
      for (const child of children) {
        if (child.children && child.children.length > 0) {
          traverse(child.children);
        } else {
          layerCounter++;
          const left = child.left ?? 0;
          const top = child.top ?? 0;
          const right = child.right ?? (child.canvas ? child.canvas.width : psd.width);
          const bottom = child.bottom ?? (child.canvas ? child.canvas.height : psd.height);
          const width = right - left;
          const height = bottom - top;

          layers.push({
            id: layerCounter,
            name: child.name || `Layer ${layerCounter}`,
            visible: !child.hidden,
            opacity: typeof child.opacity === 'number' ? child.opacity : 1,
            blendMode: child.blendMode,
            left,
            top,
            right,
            bottom,
            width,
            height,
            canvas: child.canvas,
          });
        }
      }
    };

    if (psd.children && psd.children.length > 0) {
      traverse(psd.children);
    } else {
      layers.push({
        id: 1,
        name: 'Background',
        visible: true,
        opacity: 1,
        left: 0,
        top: 0,
        right: psd.width,
        bottom: psd.height,
        width: psd.width,
        height: psd.height,
        canvas: psd.canvas,
      });
    }

    let compositeDataUrl = '';
    if (isBrowser && psd.canvas) {
      try {
        compositeDataUrl = psd.canvas.toDataURL('image/png');
      } catch {
        // Fallback for security contexts
      }
    }

    return {
      width: psd.width,
      height: psd.height,
      channels: psd.channels || 4,
      colorMode: String(psd.colorMode || 'RGB'),
      layers,
      compositeDataUrl,
      rawBuffer: buffer,
    };
  }

  /**
   * Re-composites visible layers in order from back to front onto a composite canvas.
   */
  public composite(
    psdData: PsdDocumentData,
    visibleLayerIds?: number[]
  ): string {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      return psdData.compositeDataUrl || '';
    }

    const canvas = document.createElement('canvas');
    canvas.width = psdData.width;
    canvas.height = psdData.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return psdData.compositeDataUrl || '';

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const isVisible = (layer: PsdLayerItem): boolean => {
      if (visibleLayerIds) {
        return visibleLayerIds.includes(layer.id);
      }
      return layer.visible;
    };

    for (const layer of psdData.layers) {
      if (!isVisible(layer)) continue;

      ctx.save();
      ctx.globalAlpha = layer.opacity;

      if (layer.canvas) {
        ctx.drawImage(layer.canvas, layer.left, layer.top);
      }

      ctx.restore();
    }

    const dataUrl = canvas.toDataURL('image/png');
    psdData.compositeDataUrl = dataUrl;
    return dataUrl;
  }
}

export const psdEngine = new PsdEngine();
