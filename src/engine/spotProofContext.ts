/** Isolate actual painted geometry, including alpha, without drawing selection frames. */
export function spotProofContext(context: CanvasRenderingContext2D): CanvasRenderingContext2D {
  return new Proxy(context, {
    get(target, key) {
      if (key === 'drawImage') return (image: CanvasImageSource, ...args: number[]) => {
        const size = image as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number };
        const width = size.naturalWidth || size.width || 1, height = size.naturalHeight || size.height || 1;
        const scale = Math.min(1, Math.sqrt(2_000_000 / (width * height)));
        const mask = document.createElement('canvas'); mask.width = Math.max(1, Math.round(width * scale)); mask.height = Math.max(1, Math.round(height * scale));
        const paint = mask.getContext('2d')!; paint.drawImage(image, 0, 0, mask.width, mask.height);
        paint.globalCompositeOperation = 'source-in'; paint.fillStyle = '#000'; paint.fillRect(0, 0, mask.width, mask.height);
        if (args.length === 8) for (let index = 0; index < 4; index++) args[index] *= scale;
        (target.drawImage as (...args: any[]) => void)(mask, ...args);
      };
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, key, value) {
      if (['fillStyle', 'strokeStyle', 'shadowColor'].includes(String(key)) && typeof value === 'string' && value !== 'transparent' && value !== 'none') value = '#000000';
      return Reflect.set(target, key, value, target);
    },
  });
}
