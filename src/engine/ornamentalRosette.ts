/** A deterministic, repeating design ornament. No anti-counterfeiting guarantee. */
export function ornamentalRosette(diameter: number, lobes: number, modulation: number) {
  if (!Number.isFinite(diameter) || diameter < 2 || diameter > 200) throw new Error('Choose a diameter from 2 to 200 mm.');
  if (!Number.isInteger(lobes) || lobes < 3 || lobes > 32) throw new Error('Choose 3 to 32 lobes.');
  if (!Number.isFinite(modulation) || modulation < 0.05 || modulation > 0.45) throw new Error('Choose modulation from 0.05 to 0.45.');
  const count = Math.max(360, lobes * 48), radius = diameter / 2;
  const nodes = Array.from({ length: count }, (_, index) => {
    const angle = index * 2 * Math.PI / count;
    return {
      x: radius + radius * ((1 - modulation) * Math.cos(angle) + modulation * Math.cos(lobes * angle)),
      y: radius + radius * ((1 - modulation) * Math.sin(angle) - modulation * Math.sin(lobes * angle)),
    };
  });
  const path = nodes.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(4)} ${point.y.toFixed(4)}`).join(' ') + ' Z';
  return { nodes, path };
}
