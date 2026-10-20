import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { stateManager } from '../src/state';

describe('Headless Publishing CLI Engine (recto build)', () => {
  const tmpProjectFile = path.resolve('test-cli-project.json');
  const tmpPdfOut = path.resolve('test-cli-output.pdf');
  const tmpFlipbookOut = path.resolve('test-cli-flipbook.html');
  const tmpEpubOut = path.resolve('test-cli-book.epub');

  it('runs recto build headlessly to generate print-ready PDF/X', () => {
    fs.writeFileSync(tmpProjectFile, JSON.stringify(stateManager.getState(), null, 2));

    const cliPath = path.resolve('bin/recto.js');
    execFileSync(process.execPath, [cliPath, 'build', tmpProjectFile, '--export', 'pdf/x-1a', '--output', tmpPdfOut, '--crop-marks', '--bleed'], {
      encoding: 'utf8',
    });

    expect(fs.existsSync(tmpPdfOut)).toBe(true);
    const stats = fs.statSync(tmpPdfOut);
    expect(stats.size).toBeGreaterThan(1000);

    // Verify PDF header
    const buffer = fs.readFileSync(tmpPdfOut);
    expect(buffer.toString('utf8', 0, 5)).toBe('%PDF-');
  }, 30000);

  it('runs recto build headlessly for HTML flipbook and EPUB 3', () => {
    const cliPath = path.resolve('bin/recto.js');
    execFileSync(process.execPath, [cliPath, 'build', tmpProjectFile, '--export', 'flipbook', '--output', tmpFlipbookOut], {
      encoding: 'utf8',
    });
    expect(fs.existsSync(tmpFlipbookOut)).toBe(true);
    const html = fs.readFileSync(tmpFlipbookOut, 'utf8');
    expect(html).toContain('flipbook-stage');

    execFileSync(process.execPath, [cliPath, 'build', tmpProjectFile, '--export', 'epub', '--output', tmpEpubOut], {
      encoding: 'utf8',
    });
    expect(fs.existsSync(tmpEpubOut)).toBe(true);
    const epubStats = fs.statSync(tmpEpubOut);
    expect(epubStats.size).toBeGreaterThan(500);

    // Clean up
    if (fs.existsSync(tmpProjectFile)) fs.unlinkSync(tmpProjectFile);
    if (fs.existsSync(tmpPdfOut)) fs.unlinkSync(tmpPdfOut);
    if (fs.existsSync(tmpFlipbookOut)) fs.unlinkSync(tmpFlipbookOut);
    if (fs.existsSync(tmpEpubOut)) fs.unlinkSync(tmpEpubOut);
  }, 60000);
});
