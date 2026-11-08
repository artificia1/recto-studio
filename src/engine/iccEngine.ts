import type { RenderingIntent } from '../types';
import { inspectIccHeader } from './iccProfiles';
import { TYPE_CMYK_8, TYPE_RGB_8 } from '@kittl/little-cms/formats';
import { FLAGS_IDENTITY, setBlackPointCompensation } from '@kittl/little-cms/flags';
import * as cms from '@kittl/little-cms';

let initialization: Promise<void> | undefined;
export function initializeCms(wasmPath?: string): Promise<void> {
  initialization ||= cms.initWasm(wasmPath).then(result => { if (result.error) throw result.error; }).catch(error => { initialization = undefined; throw error; });
  return initialization;
}

export function describeOutputProfile(bytes: Uint8Array): string {
  const header = inspectIccHeader(bytes);
  if (header.colorSpace !== 'CMYK' || header.profileClass !== 'prtr') throw new Error('Import a CMYK printer output ICC profile.');
  const profile = cms.cmsOpenProfileFromMem(bytes).valueOrThrow;
  try {
    if (cms.cmsGetColorSpace(profile).valueOrThrow !== cms.IccColorSpaceMap.CMYK) throw new Error('The ICC profile does not describe CMYK output.');
    return cms.cmsGetProfileInfoASCII(profile, cms.CmsPrintInfoType.Description, 'en', 'US').valueOrThrow || 'CMYK output profile';
  } finally { cms.cmsCloseProfile(profile); }
}

export interface IccTransformOptions {
  profile: Uint8Array;
  pixels: Uint8Array;
  direction: 'rgb-to-cmyk' | 'cmyk-to-rgb';
  intent: RenderingIntent;
  blackPointCompensation: boolean;
  preservePureBlack?: boolean;
}

/** Own and release every native handle; return only detached JS pixel storage. */
export function transformIcc(options: IccTransformOptions): Uint8Array {
  const header = inspectIccHeader(options.profile);
  if (header.colorSpace !== 'CMYK' || header.profileClass !== 'prtr') throw new Error('Select a CMYK printer output profile.');
  const inputChannels = options.direction === 'rgb-to-cmyk' ? 3 : 4;
  if (!options.pixels.length || options.pixels.length % inputChannels || options.pixels.length > 32 * 1024 * 1024) throw new Error('Convert a non-empty pixel tile up to 32 MiB.');
  const intent = { perceptual: 0, relative: 1, saturation: 2, absolute: 3 }[options.intent];
  if (intent === undefined) throw new Error('Choose a supported rendering intent.');
  const output = cms.cmsOpenProfileFromMem(options.profile).valueOrThrow;
  let srgb: ReturnType<typeof cms.cmsCreate_sRGBProfile>['value'];
  let transform: ReturnType<typeof cms.cmsCreateTransform>['value'];
  try {
    srgb = cms.cmsCreate_sRGBProfile().valueOrThrow;
    const toCmyk = options.direction === 'rgb-to-cmyk';
    transform = cms.cmsCreateTransform(toCmyk ? srgb : output, toCmyk ? TYPE_RGB_8 : TYPE_CMYK_8,
      toCmyk ? output : srgb, toCmyk ? TYPE_CMYK_8 : TYPE_RGB_8, intent,
      setBlackPointCompensation(FLAGS_IDENTITY, options.blackPointCompensation)).valueOrThrow;
    const result = cms.cmsDoTransform(transform, options.pixels, options.pixels.length / inputChannels).valueOrThrow;
    if (toCmyk && options.preservePureBlack) for (let i = 0, out = 0; i < options.pixels.length; i += 3, out += 4) {
      if (options.pixels[i] === 0 && options.pixels[i + 1] === 0 && options.pixels[i + 2] === 0) result.set([0, 0, 0, 255], out);
    }
    return result;
  } finally {
    if (transform) cms.cmsDeleteTransform(transform);
    if (srgb) cms.cmsCloseProfile(srgb);
    cms.cmsCloseProfile(output);
  }
}
