const align4 = (length: number) => Math.ceil(length / 4) * 4;

function checksum(bytes: Uint8Array, zeroOffset = -1) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    if (i === zeroOffset) continue;
    const word = (bytes[i] << 24) | ((bytes[i + 1] || 0) << 16) | ((bytes[i + 2] || 0) << 8) | (bytes[i + 3] || 0);
    sum = (sum + word) >>> 0;
  }
  return sum;
}

export function packSfnt(tables: Map<string, Uint8Array>, signature = 0x10000) {
  const tags = [...tables.keys()].sort();
  const count = tags.length, searchPower = 2 ** Math.floor(Math.log2(count));
  let offset = 12 + count * 16;
  const bytes = new Uint8Array(offset + [...tables.values()].reduce((sum, table) => sum + align4(table.length), 0));
  const view = new DataView(bytes.buffer);
  view.setUint32(0, signature); view.setUint16(4, count);
  view.setUint16(6, searchPower * 16); view.setUint16(8, Math.log2(searchPower)); view.setUint16(10, (count - searchPower) * 16);
  let headOffset = 0;
  tags.forEach((tag, index) => {
    const table = tables.get(tag)!;
    const entry = 12 + index * 16;
    bytes.set(new TextEncoder().encode(tag), entry);
    view.setUint32(entry + 4, checksum(table, tag === 'head' ? 8 : -1)); view.setUint32(entry + 8, offset); view.setUint32(entry + 12, table.length);
    if (tag === 'head') headOffset = offset;
    bytes.set(table, offset); offset += align4(table.length);
  });
  if (!headOffset) throw new Error('The font has no head table.');
  view.setUint32(headOffset + 8, (0xb1b0afba - checksum(bytes, headOffset + 8)) >>> 0);
  return bytes;
}
