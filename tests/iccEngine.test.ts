import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { inspectIccHeader, createProfileAsset, profileBytes } from '../src/engine/iccProfiles';
import { initializeCms, describeOutputProfile, transformIcc } from '../src/engine/iccEngine';
import { StateManager } from '../src/state/stateManager';
import { parseProject } from '../src/state/projectValidation';
import { jsPDF } from 'jspdf';
import { Resvg } from '@resvg/resvg-js';
import { prepareManagedPdf } from '../src/export/iccPdf';
import { applyCmykFillColor } from '../src/export/pdfColors';
import { inflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const profile = new Uint8Array(readFileSync('tests/fixtures/icc/lcms-test-output.icc'));
describe('LittleCMS ICC colour management', () => {
  it('parses a real CMYK profile and rejects truncated or out-of-bounds profile tags', () => {
    expect(inspectIccHeader(profile)).toMatchObject({ colorSpace: 'CMYK', profileClass: 'prtr', version: 2 });
    const inputOnly = new Uint8Array(readFileSync('tests/fixtures/icc/CGATS001Compat-v2-micro.icc'));
    expect(inspectIccHeader(inputOnly).profileClass).toBe('scnr');
    expect(() => inspectIccHeader(profile.slice(0, 300))).toThrow('complete');
    const invalid = profile.slice(); new DataView(invalid.buffer).setUint32(136, invalid.length + 4);
    expect(() => inspectIccHeader(invalid)).toThrow('outside');
  });
  it('runs an actual WASM transform in both directions and releases its handles', async () => {
    await initializeCms();
    expect(() => describeOutputProfile(new Uint8Array(readFileSync('tests/fixtures/icc/CGATS001Compat-v2-micro.icc')))).toThrow('output');
    expect(describeOutputProfile(profile)).toBeTruthy();
    const pixels = new Uint8Array([255, 255, 255, 0, 0, 0, 128, 96, 64, 255, 0, 0]);
    const options = { profile, pixels, direction: 'rgb-to-cmyk' as const, intent: 'relative' as const, blackPointCompensation: true };
    const first = transformIcc(options);
    expect(first.length).toBe(16);
    expect(first.slice(0, 4)).toEqual(new Uint8Array([0, 0, 0, 0]));
    const black = transformIcc({ ...options, preservePureBlack: true });
    expect(black.slice(4, 8)).toEqual(new Uint8Array([0, 0, 0, 255]));
    expect(transformIcc(options)).toEqual(first);
    const proof = transformIcc({ ...options, pixels: first, direction: 'cmyk-to-rgb' });
    expect(proof.length).toBe(pixels.length);
    expect(Array.from(proof.slice(0, 3)).every(value => value >= 250)).toBe(true);
    expect(() => transformIcc({ ...options, pixels: new Uint8Array([1, 2]) })).toThrow('tile');
  });
  it('persists profile bytes and settings, supports undo, and validates imported projects', async () => {
    const asset = await createProfileAsset(profile, 'Printer.icc', 'Printer output');
    const manager = new StateManager(); manager.createBlankProject('A4', 'ICC test', false);
    manager.updateSettings({ colorManagement: { outputProfile: asset, intent: 'relative', blackPointCompensation: true,
      preservePureBlack: true, convertPdf: true, tacLimit: 320 } });
    const saved = parseProject(manager.exportJson(), manager.getState());
    expect(profileBytes(saved.settings.colorManagement!.outputProfile)).toEqual(profile);
    manager.undo(); expect(manager.getState().settings.colorManagement).toBeUndefined();
    const broken = structuredClone(saved); broken.settings.colorManagement!.tacLimit = 999;
    expect(() => parseProject(JSON.stringify(broken), manager.getState())).toThrow('TAC');
  });
  it('embeds the original output profile and preserves real CMYK image samples and alpha', async () => {
    const asset = await createProfileAsset(profile, 'Test.icc', 'LittleCMS test output');
    const manager = new StateManager(); manager.createBlankProject('A4', 'Managed PDF', false);
    manager.updateSettings({ colorManagement: { outputProfile: asset, intent: 'relative', blackPointCompensation: true,
      preservePureBlack: true, convertPdf: true, tacLimit: 320 } });
    const doc = new jsPDF({ compress: false });
    const managed = (await prepareManagedPdf(doc, manager.getState()))!;
    applyCmykFillColor(doc, '#222222'); doc.rect(10, 10, 20, 20, 'F');
    const image = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="1"><path fill="#806040" d="M0 0h1v1H0z"/><path fill="red" fill-opacity="0.5" d="M1 0h1v1H1z"/></svg>').render();
    const source = `data:image/png;base64,${image.asPng().toString('base64')}`;
    const converted = await managed.raster(source);
    doc.addImage(converted.bytes, 'RECTOCMYK', 10, 40, 20, 10, converted.alias);
    const images = (doc.internal as any).collections.addImage_images;
    const emitted = Object.values(images)[0] as { colorSpace: string; data: string; sMask: string };
    expect(emitted.colorSpace).toBe('DeviceCMYK');
    const stored = inflateSync(Buffer.from(emitted.data, 'binary'));
    const expected = transformIcc({ profile, pixels: new Uint8Array([128, 96, 64, 255, 0, 0]), direction: 'rgb-to-cmyk', intent: 'relative', blackPointCompensation: true, preservePureBlack: true });
    expect(Array.from(stored, value => 255 - value)).toEqual(Array.from(expected));
    expect([...inflateSync(Buffer.from(emitted.sMask, 'binary'))]).toEqual([255, 128]);
    const pdf = doc.output();
    expect(pdf).toContain('/OutputIntents ['); expect(pdf).toContain('/DestOutputProfile');
    expect(pdf).toContain('/Decode [1 0 1 0 1 0 1 0]');
    mkdirSync('test-results/icc', { recursive: true });
    writeFileSync('test-results/icc/managed.pdf', Buffer.from(doc.output('arraybuffer')));
    expect(doc.getNumberOfPages()).toBe(1);
  });
});
