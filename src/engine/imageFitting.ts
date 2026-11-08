import type { ImageFitMode } from '../types';

export interface ImageFitTransform {
  drawX: number;
  drawY: number;
  drawW: number;
  drawH: number;
  scaleX?: number;
  scaleY?: number;
}

export function calculateImageFitting(
  frameX: number,
  frameY: number,
  frameW: number,
  frameH: number,
  imgW: number,
  imgH: number,
  fitMode: ImageFitMode = 'fill',
  focalPoint?: { x: number; y: number }
): ImageFitTransform {
  if (imgW <= 0 || imgH <= 0 || frameW <= 0 || frameH <= 0) {
    return { drawX: frameX, drawY: frameY, drawW: frameW, drawH: frameH, scaleX: 1, scaleY: 1 };
  }

  switch (fitMode) {
    case 'fill': {
      // 1. Fill Frame Proportionally (Ctrl+Alt+Shift+C):
      // Scales image proportionally to fill the frame; crops excess. Centered in frame.
      const scale = Math.max(frameW / imgW, frameH / imgH);
      const drawW = imgW * scale;
      const drawH = imgH * scale;
      const focal = (value: number | undefined) => Number.isFinite(value) ? Math.max(0, Math.min(1, value!)) : 0.5;
      const drawX = frameX + Math.max(frameW - drawW, Math.min(0, frameW / 2 - drawW * focal(focalPoint?.x)));
      const drawY = frameY + Math.max(frameH - drawH, Math.min(0, frameH / 2 - drawH * focal(focalPoint?.y)));
      return { drawX, drawY, drawW, drawH, scaleX: scale, scaleY: scale };
    }

    case 'fit': {
      // 2. Fit Content Proportionally (Ctrl+Alt+Shift+E):
      // Scales image proportionally so entire content fits within frame; no crop. Centered in frame.
      const scale = Math.min(frameW / imgW, frameH / imgH);
      const drawW = imgW * scale;
      const drawH = imgH * scale;
      const drawX = frameX + (frameW - drawW) / 2;
      const drawY = frameY + (frameH - drawH) / 2;
      return { drawX, drawY, drawW, drawH, scaleX: scale, scaleY: scale };
    }

    case 'frameToContent': {
      // 3. Fit Frame to Content (Ctrl+Alt+C):
      // Proportional content fit matching adjusted frame bounds.
      const scale = Math.min(frameW / imgW, frameH / imgH);
      const drawW = imgW * scale;
      const drawH = imgH * scale;
      const drawX = frameX + (frameW - drawW) / 2;
      const drawY = frameY + (frameH - drawH) / 2;
      return { drawX, drawY, drawW, drawH, scaleX: scale, scaleY: scale };
    }

    case 'contentToFrame':
    case 'stretch': {
      // 4. Fit Content to Frame (Ctrl+Alt+E):
      // Anamorphic stretch: content dimensions match frame bounds exactly.
      return {
        drawX: frameX,
        drawY: frameY,
        drawW: frameW,
        drawH: frameH,
        scaleX: frameW / imgW,
        scaleY: frameH / imgH,
      };
    }

    case 'center': {
      // 5. Center Content (Ctrl+Shift+E):
      // Centers content within frame without altering intrinsic scale.
      const drawW = imgW;
      const drawH = imgH;
      const drawX = frameX + (frameW - drawW) / 2;
      const drawY = frameY + (frameH - drawH) / 2;
      return { drawX, drawY, drawW, drawH, scaleX: 1, scaleY: 1 };
    }

    default:
      return { drawX: frameX, drawY: frameY, drawW: frameW, drawH: frameH, scaleX: 1, scaleY: 1 };
  }
}
