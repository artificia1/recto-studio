import type { ProofPage } from './proofComparison';

export const proofScanEdge = 384;

async function digest(bytes: Uint8Array<ArrayBuffer>) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function proofFingerprint(text: string, pixels: Uint8ClampedArray, natural: { width: number; height: number }): Promise<ProofPage> {
  const width = Math.round(natural.width * 100) / 100, height = Math.round(natural.height * 100) / 100;
  const [textSignature, artwork] = await Promise.all([
    digest(new TextEncoder().encode(text.replace(/\s+/g, ' ').trim())),
    digest(new Uint8Array(pixels)),
  ]);
  return { width, height, textSignature, signature: [width, height, textSignature, artwork].join(':') };
}
