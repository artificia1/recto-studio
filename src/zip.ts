// Zero-dependency browser-native & Node 18+ ZIP Reader & Writer using Streams API

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

export async function readZip(buffer: ArrayBuffer | Uint8Array, maxBytes = Infinity): Promise<Map<string, Uint8Array>> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = new Map<string, Uint8Array>();
  let remainingBytes = maxBytes;
  const store = (name: string, data: Uint8Array) => {
    if (data.length > remainingBytes) throw new Error('The expanded archive exceeds the import size limit.');
    remainingBytes -= data.length;
    entries.set(name, data);
  };

  // 1. Locate End of Central Directory (EOCD) signature: 0x06054b50
  let eocdOffset = -1;
  const minEocdSearch = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minEocdSearch; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset !== -1) {
    const totalEntries = view.getUint16(eocdOffset + 10, true);
    const cdOffset = view.getUint32(eocdOffset + 16, true);
    let offset = cdOffset;

    for (let i = 0; i < totalEntries && offset < eocdOffset; i++) {
      if (view.getUint32(offset, true) !== 0x02014b50) break;

      const compressionMethod = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const fileNameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localHeaderOffset = view.getUint32(offset + 42, true);

      const nameBytes = bytes.subarray(offset + 46, offset + 46 + fileNameLength);
      const fileName = new TextDecoder().decode(nameBytes);

      offset += 46 + fileNameLength + extraLength + commentLength;

      // Extract from local header
      if (localHeaderOffset + 30 <= bytes.length && view.getUint32(localHeaderOffset, true) === 0x04034b50) {
        const localNameLen = view.getUint16(localHeaderOffset + 26, true);
        const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
        const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
        const compressedData = bytes.subarray(dataStart, dataStart + compressedSize);

        if (compressionMethod === 0) {
          // Stored (no compression)
          store(fileName, compressedData);
        } else if (compressionMethod === 8) {
          // Deflated
          const decompressed = await decompressDeflateRaw(compressedData, remainingBytes);
          store(fileName, decompressed);
        }
      }
    }
  } else {
    // Fallback: sequential scan for local headers (0x04034b50)
    let offset = 0;
    while (offset + 30 < bytes.length) {
      if (view.getUint32(offset, true) !== 0x04034b50) {
        offset++;
        continue;
      }

      const compressionMethod = view.getUint16(offset + 8, true);
      const compressedSize = view.getUint32(offset + 18, true);
      const fileNameLength = view.getUint16(offset + 26, true);
      const extraLength = view.getUint16(offset + 28, true);

      const fileName = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + fileNameLength));
      const dataStart = offset + 30 + fileNameLength + extraLength;
      const compressedData = bytes.subarray(dataStart, dataStart + compressedSize);

      if (compressedSize > 0) {
        if (compressionMethod === 0) {
          store(fileName, compressedData);
        } else if (compressionMethod === 8) {
          const decompressed = await decompressDeflateRaw(compressedData, remainingBytes);
          store(fileName, decompressed);
        }
      }
      offset = dataStart + compressedSize;
    }
  }

  return entries;
}

export async function decompressDeflateRaw(data: Uint8Array, maxBytes = Infinity): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    const writing = writer.write(data as any).then(() => writer.close());
    // The readable side reports decompression errors; cancellation also rejects writes.
    void writing.catch(() => {});
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    let bytesRead = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        bytesRead += value.length;
        if (bytesRead > maxBytes) {
          await reader.cancel();
          throw new Error('The expanded archive exceeds the import size limit.');
        }
        chunks.push(value);
      }
    }
    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }
  return data;
}

// Precomputed CRC32 table for ZIP archives
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[n] = c >>> 0;
}

export function crc32(data: Uint8Array): number {
  let crc = 0 ^ (-1);
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[i]) & 0xff];
  }
  return (crc ^ (-1)) >>> 0;
}

// Simple ZIP archive generator for creating tests or packages (Stored mode: 0)
export function createZipArchive(files: Record<string, string | Uint8Array>): Uint8Array {
  const fileEntries: { name: Uint8Array; data: Uint8Array; offset: number; crc: number }[] = [];
  const parts: Uint8Array[] = [];
  let currentOffset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = new TextEncoder().encode(name);
    const dataBytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    const fileCrc = crc32(dataBytes);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true); // Local header signature
    lv.setUint16(4, 20, true); // Version needed (2.0)
    lv.setUint16(6, 0, true); // General purpose bit flag
    lv.setUint16(8, 0, true); // Compression: 0 (Stored)
    lv.setUint16(10, 0, true); // Time
    lv.setUint16(12, 0, true); // Date
    lv.setUint32(14, fileCrc, true); // CRC32
    lv.setUint32(18, dataBytes.length, true); // Compressed size
    lv.setUint32(22, dataBytes.length, true); // Uncompressed size
    lv.setUint16(26, nameBytes.length, true); // Filename length
    lv.setUint16(28, 0, true); // Extra field length
    localHeader.set(nameBytes, 30);

    fileEntries.push({ name: nameBytes, data: dataBytes, offset: currentOffset, crc: fileCrc });
    parts.push(localHeader, dataBytes);
    currentOffset += localHeader.length + dataBytes.length;
  }

  const cdStart = currentOffset;
  for (const entry of fileEntries) {
    const cdHeader = new Uint8Array(46 + entry.name.length);
    const cv = new DataView(cdHeader.buffer);
    cv.setUint32(0, 0x02014b50, true); // Central directory signature
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true); // Method 0
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, entry.crc, true); // CRC32
    cv.setUint32(20, entry.data.length, true);
    cv.setUint32(24, entry.data.length, true);
    cv.setUint16(28, entry.name.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, entry.offset, true); // Local header offset
    cdHeader.set(entry.name, 46);

    parts.push(cdHeader);
    currentOffset += cdHeader.length;
  }

  const cdSize = currentOffset - cdStart;
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); // EOCD signature
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, fileEntries.length, true); // Total entries on disk
  ev.setUint16(10, fileEntries.length, true); // Total entries
  ev.setUint32(12, cdSize, true); // Central directory size
  ev.setUint32(16, cdStart, true); // Central directory offset
  ev.setUint16(20, 0, true); // Comment length
  parts.push(eocd);

  const totalLength = parts.reduce((acc, p) => acc + p.length, 0);
  const out = new Uint8Array(totalLength);
  let pos = 0;
  for (const part of parts) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

export function base64ToUint8Array(base64Str: string): Uint8Array {
  const clean = (base64Str.includes(',') ? base64Str.split(',')[1] : base64Str).replace(/\s+/g, '');
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(clean, 'base64'));
  }
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

