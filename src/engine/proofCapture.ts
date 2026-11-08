export type ProofCapture = (spot?: string) => HTMLCanvasElement;
let capture: ProofCapture | undefined;
export function registerProofCapture(provider: ProofCapture) {
  capture = provider;
  return () => { if (capture === provider) capture = undefined; };
}
export function captureProofArtwork(spot?: string) {
  if (!capture) throw new Error('The page canvas is not ready.');
  return capture(spot);
}
