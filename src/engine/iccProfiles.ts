import type { IccProfileAsset } from '../types';
import { base64ToUint8Array, uint8ArrayToBase64 } from '../zip';

export const MAX_ICC_BYTES = 16 * 1024 * 1024;
const ascii = (bytes: Uint8Array, offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));

/** Check profile boundaries before passing untrusted bytes to the WASM parser. */
export function inspectIccHeader(bytes: Uint8Array) {
  if (bytes.length < 132 || bytes.length > MAX_ICC_BYTES) throw new Error('ICC profiles must be between 132 bytes and 16 MiB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== bytes.length || ascii(bytes, 36) !== 'acsp') throw new Error('This file is not a complete ICC profile.');
  const version = bytes[8];
  if (version !== 2 && version !== 4) throw new Error('Use an ICC v2 or v4 profile.');
  const colorSpace = ascii(bytes, 16), profileClass = ascii(bytes, 12), pcs = ascii(bytes, 20);
  if (!['CMYK', 'RGB '].includes(colorSpace) || !['XYZ ', 'Lab '].includes(pcs)) throw new Error('Use an RGB or CMYK profile with an XYZ or Lab connection space.');
  const count = view.getUint32(128), tableEnd = 132 + count * 12;
  if (!count || count > 512 || tableEnd > bytes.length) throw new Error('The ICC tag table is invalid or too large.');
  for (let index = 0; index < count; index++) {
    const start = view.getUint32(132 + index * 12 + 4), size = view.getUint32(132 + index * 12 + 8);
    if (start % 4 || start < tableEnd || !size || start + size > bytes.length) throw new Error('An ICC tag points outside the profile data.');
  }
  return { version, colorSpace, profileClass, pcs };
}

export function profileBytes(profile: IccProfileAsset): Uint8Array {
  if (typeof profile?.data !== 'string' || profile.data.length > Math.ceil(MAX_ICC_BYTES / 3) * 4) throw new Error('The stored ICC profile is too large.');
  const bytes = base64ToUint8Array(profile.data);
  const header = inspectIccHeader(bytes);
  if (header.profileClass !== 'prtr' || header.colorSpace !== 'CMYK') throw new Error('Choose a CMYK printer output profile, rather than a display or DeviceLink profile.');
  return bytes;
}

export async function createProfileAsset(bytes: Uint8Array, name: string, description: string): Promise<IccProfileAsset> {
  inspectIccHeader(bytes);
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  const id = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const profile = { id, name: name.slice(0, 200), description: description.slice(0, 500), data: uint8ArrayToBase64(bytes) };
  profileBytes(profile);
  return profile;
}
