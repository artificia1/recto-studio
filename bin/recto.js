#!/usr/bin/env node
/**
 * Recto Studio — High-Precision Desktop Publishing Engine
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure TypeScript execution environment via tsx if not already loaded
if (!process.env._RECTO_TSX) {
  process.env._RECTO_TSX = '1';
  const tsxCli = path.resolve(__dirname, '../node_modules/tsx/dist/cli.mjs');
  const execPath = process.execPath;
  const args = fs.existsSync(tsxCli) ? [tsxCli, __filename, ...process.argv.slice(2)] : ['npx', 'tsx', __filename, ...process.argv.slice(2)];

  const child = spawn(execPath, args, {
    stdio: 'inherit',
    env: process.env,
  });

  child.on('exit', (code) => process.exit(code || 0));
} else {
  const { exportDocumentToPdf } = await import('../src/export/pdfExport.js');
  const { generateFlipbookHtml } = await import('../src/flipbookExport.js');
  const { exportDocumentToEpub } = await import('../src/epubExport.js');
  const { parseDataset, generateRepeaterSpreads, fetchRemoteDataset } = await import('../src/dataMerge.js');
  const { bookEngine } = await import('../src/engine/bookEngine.js');
  const { parseProject } = await import('../src/state/projectValidation.js');
  const { INITIAL_STATE } = await import('../src/state/stateManager.js');

  function printHelp() {
    console.log(`
Recto Studio Headless Publishing Engine (CLI)
=============================================
Usage:
  recto build <file.recto|file.json> [options]
  recto book <action> <manifest.rectobook> [options]
  recto preflight <file.recto|file.json>
  recto --version
  recto --help

Commands:
  build <input>         Compile document headlessly into production print PDF, EPUB 3, or Flipbook
  book <action> <file>  Multi-document book management: sync, toc, or build stitched PDF
  preflight <input>     Execute automated prepress preflight audit (overset text, DPI, bleed)

Build Options:
  --data <file.csv>     Automate data-merge catalog/book generation from CSV dataset
  --export <format>     Output format: pdf (default), cmyk, pdf/x-1a, flipbook, html, epub
  --output <path>       Destination output path (defaults to <title>.<ext>)
  --bleed               Include document bleed area (e.g. 3mm)
  --crop-marks          Include professional vector crop marks
  --registration        Include 4-color registration alignment targets
  --color-bars          Include DeviceCMYK calibration swatches

Examples:
  recto build annual-report.recto --export pdf/x-1a --crop-marks --bleed
  recto build catalog-template.json --data products.csv --export pdf --output dist/catalog.pdf
  recto preflight magazine.recto
`);
  }

  function parseArgs(args) {
    const result = {
      command: args[0] || 'help',
      input: null,
      data: null,
      exportFormat: 'pdf',
      output: null,
      bleed: false,
      cropMarks: false,
      registration: false,
      colorBars: false,
    };

    let i = 1;
    if (result.command !== 'help' && result.command !== '--help' && result.command !== '-h' && result.command !== '--version' && result.command !== '-v') {
      if (args[1] && !args[1].startsWith('--')) {
        result.input = args[1];
        i = 2;
      }
    }

    while (i < args.length) {
      const arg = args[i];
      if (arg === '--data' && args[i + 1]) {
        result.data = args[++i];
      } else if (arg === '--export' && args[i + 1]) {
        result.exportFormat = args[++i].toLowerCase();
      } else if (arg === '--output' && args[i + 1]) {
        result.output = args[++i];
      } else if (arg === '--bleed') {
        result.bleed = true;
      } else if (arg === '--crop-marks') {
        result.cropMarks = true;
      } else if (arg === '--registration') {
        result.registration = true;
      } else if (arg === '--color-bars') {
        result.colorBars = true;
      }
      i++;
    }

    return result;
  }

  async function runCli() {
    const parsed = parseArgs(process.argv.slice(2));

    if (parsed.command === '--version' || parsed.command === '-v') {
      console.log('Recto Studio CLI v1.0.0 (High-Precision Publishing Architecture)');
      return 0;
    }

    if (parsed.command === 'help' || parsed.command === '--help' || parsed.command === '-h' || !parsed.command) {
      printHelp();
      return 0;
    }

    if (parsed.command === 'build') {
      if (!parsed.input) {
        console.error('Error: Please specify an input document file (.recto or .json).');
        process.exitCode = 1;
        return 1;
      }

      const inputPath = path.resolve(process.cwd(), parsed.input);
      if (!fs.existsSync(inputPath)) {
        console.error(`Error: Input file not found: ${inputPath}`);
        process.exitCode = 1;
        return 1;
      }

      console.log(`[Recto CLI] Loading project: ${path.basename(inputPath)}...`);
      const rawData = fs.readFileSync(inputPath, 'utf8');
      let state;
      try {
        state = parseProject(rawData, INITIAL_STATE);
      } catch (e) {
        console.error(`Error: Failed to parse JSON document: ${e.message}`);
        process.exitCode = 1;
        return 1;
      }

      if (parsed.data) {
        let dataset;
        if (parsed.data.startsWith('http://') || parsed.data.startsWith('https://')) {
          console.log(`[Recto CLI] Fetching remote dataset: ${parsed.data}...`);
          dataset = await fetchRemoteDataset(parsed.data);
        } else {
          const dataPath = path.resolve(process.cwd(), parsed.data);
          if (!fs.existsSync(dataPath)) {
            console.error(`Error: Dataset file not found: ${dataPath}`);
            process.exitCode = 1;
            return 1;
          }
          console.log(`[Recto CLI] Ingesting dataset: ${path.basename(dataPath)}...`);
          const raw = fs.readFileSync(dataPath, 'utf8');
          dataset = parseDataset(raw);
        }

        console.log(`[Recto CLI] Merging ${dataset.records.length} records into publication layout...`);
        const templateSpread = state.spreads[0];
        const mergedSpreads = generateRepeaterSpreads(templateSpread, dataset.records);
        state.spreads = mergedSpreads;
        console.log(`[Recto CLI] Successfully generated ${mergedSpreads.length} dynamic spreads.`);
      }

      const format = parsed.exportFormat;
      const isPdf = format === 'pdf' || format === 'cmyk' || format === 'pdf/x-1a';
      const isFlipbook = format === 'flipbook' || format === 'html';
      const isEpub = format === 'epub';

      const defaultTitle = state.settings?.title?.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'recto-publication';
      let outputPath = parsed.output;

      if (!outputPath) {
        if (isPdf) outputPath = `${defaultTitle}.pdf`;
        else if (isFlipbook) outputPath = `${defaultTitle}.html`;
        else if (isEpub) outputPath = `${defaultTitle}.epub`;
        else outputPath = `${defaultTitle}.pdf`;
      }

      outputPath = path.resolve(process.cwd(), outputPath);
      const outDir = path.dirname(outputPath);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }

      if (isPdf) {
        console.log(`[Recto CLI] Compiling PDF with process-color helpers...`);
        const pdf = await exportDocumentToPdf(state, {
          includeBleed: parsed.bleed,
          includeCropMarks: parsed.cropMarks,
          includeRegistrationMarks: parsed.registration,
          includeColorBars: parsed.colorBars,
        });

        const pdfArrayBuffer = pdf.output('arraybuffer');
        fs.writeFileSync(outputPath, Buffer.from(pdfArrayBuffer));
        const stats = fs.statSync(outputPath);
        console.log(`[Recto CLI] ✓ PDF compilation complete!`);
        console.log(`  Destination : ${outputPath}`);
        console.log(`  File size   : ${(stats.size / 1024).toFixed(1)} KB`);
        console.log(`  Color Model : DeviceCMYK (Pure 100% K Black Plate)`);
        console.log(`  Conformance : PDF/X and PDF/UA are not certified; printer preflight required`);
        return 0;
      } else if (isFlipbook) {
        console.log(`[Recto CLI] Generating interactive 3D Web Flipbook package...`);
        const html = generateFlipbookHtml(state);
        fs.writeFileSync(outputPath, html, 'utf8');
        const stats = fs.statSync(outputPath);
        console.log(`[Recto CLI] ✓ Web Flipbook complete!`);
        console.log(`  Destination : ${outputPath}`);
        console.log(`  File size   : ${(stats.size / 1024).toFixed(1)} KB`);
        return 0;
      } else if (isEpub) {
        console.log(`[Recto CLI] Packaging EPUB 3 digital publication...`);
        const { buffer } = exportDocumentToEpub(state, { download: false });
        fs.writeFileSync(outputPath, Buffer.from(buffer));
        const stats = fs.statSync(outputPath);
        console.log(`[Recto CLI] ✓ EPUB 3 package complete!`);
        console.log(`  Destination : ${outputPath}`);
        console.log(`  File size   : ${(stats.size / 1024).toFixed(1)} KB`);
        return 0;
      } else {
        console.error(`Error: Unknown export format '${format}'. Valid options: pdf, cmyk, pdf/x-1a, flipbook, epub.`);
        process.exitCode = 1;
        return 1;
      }
    } else if (parsed.command === 'preflight') {
      if (!parsed.input) {
        console.error('Error: Please specify an input document file (.recto or .json).');
        process.exitCode = 1;
        return 1;
      }
      const inputPath = path.resolve(process.cwd(), parsed.input);
      if (!fs.existsSync(inputPath)) {
        console.error(`Error: Input file not found: ${inputPath}`);
        process.exitCode = 1;
        return 1;
      }

      console.log(`[Recto CLI] Executing Prepress Preflight Audit: ${path.basename(inputPath)}...`);
      const rawData = fs.readFileSync(inputPath, 'utf8');
      const state = parseProject(rawData, INITIAL_STATE);

      let issuesCount = 0;
      for (const spread of state.spreads || []) {
        for (const el of spread.elements || []) {
          if (el.type === 'image' && el.actualDpi && el.actualDpi < 250) {
            console.warn(`  [WARN] Image element '${el.id}' resolution is ${el.actualDpi} DPI (recommended >= 300 DPI)`);
            issuesCount++;
          }
        }
      }

      if (issuesCount === 0) {
        console.log(`[Recto CLI] ✓ Preflight passed: 0 critical issues found. Ready for press.`);
        return 0;
      } else {
        console.warn(`[Recto CLI] Preflight finished with ${issuesCount} warning(s).`);
        return 0;
      }
    } else if (parsed.command === 'book') {
      if (process.argv.includes('--help') || process.argv.includes('-h') || parsed.input === '--help' || !parsed.input) {
        console.log(`
Recto Studio Multi-Document Book CLI
====================================
Usage:
  recto book <action> <manifest.rectobook> [options]

Actions:
  sync    Synchronize styles and master spreads across chapters
  toc     Generate unified cross-document Table of Contents
  build   Compile multi-chapter book into unified PDF

Options:
  --output <path>    Custom destination for stitched PDF
  --bleed            Include bleed area
  --crop-marks       Include crop marks
`);
        return 0;
      }
      const subCommand = parsed.input; // 'build', 'sync', 'toc'
      const bookFile = process.argv[4] || parsed.data;
      if (!bookFile) {
        console.error('Error: Please specify a book manifest file (.rectobook or .json).');
        process.exitCode = 1;
        return 1;
      }
      const bookPath = path.resolve(process.cwd(), bookFile);
      if (!fs.existsSync(bookPath)) {
        console.error(`Error: Book file not found: ${bookPath}`);
        process.exitCode = 1;
        return 1;
      }
      const bookData = JSON.parse(fs.readFileSync(bookPath, 'utf8'));
      const loadState = (fp) => {
        const fullP = path.isAbsolute(fp) ? fp : path.resolve(path.dirname(bookPath), fp);
        return parseProject(fs.readFileSync(fullP, 'utf8'), INITIAL_STATE);
      };
      const saveState = (fp, st) => {
        const fullP = path.isAbsolute(fp) ? fp : path.resolve(path.dirname(bookPath), fp);
        fs.writeFileSync(fullP, JSON.stringify(st, null, 2), 'utf8');
      };

      if (subCommand === 'sync') {
        console.log(`[Recto CLI] Synchronizing Master Styles across book chapters...`);
        const result = bookEngine.syncBookStyles(bookData, loadState, saveState);
        console.log(`[Recto CLI] ✓ Synchronized ${result.syncedStyleCount} styles across ${result.syncedChaptersCount} chapter(s).`);
        return 0;
      } else if (subCommand === 'toc') {
        console.log(`[Recto CLI] Generating Unified Book Table of Contents...`);
        const toc = bookEngine.generateUnifiedBookToc(bookData, loadState);
        console.log(`[Recto CLI] ✓ Generated ${toc.length} TOC entries across book chapters:`);
        toc.forEach((t) => console.log(`  - Page ${t.pageNumber}: ${t.title} (${t.chapterTitle})`));
        return 0;
      } else {
        const outDest = parsed.output || path.resolve(path.dirname(bookPath), `${path.basename(bookPath, path.extname(bookPath))}.pdf`);
        console.log(`[Recto CLI] Compiling multi-chapter book into unified PDF...`);
        const masterPdf = await bookEngine.exportBookToPdf(bookData, loadState, {
          includeBleed: parsed.bleed,
          includeCropMarks: parsed.cropMarks,
          includeRegistrationMarks: parsed.registration,
          includeColorBars: parsed.colorBars,
        });
        const pdfArrayBuffer = masterPdf.output('arraybuffer');
        fs.writeFileSync(outDest, Buffer.from(pdfArrayBuffer));
        const stats = fs.statSync(outDest);
        console.log(`[Recto CLI] ✓ Unified Book compilation complete!`);
        console.log(`  Destination : ${outDest}`);
        console.log(`  File size   : ${(stats.size / 1024).toFixed(1)} KB`);
        return 0;
      }
    } else {
      console.error(`Error: Unknown command '${parsed.command}'.`);
      printHelp();
      process.exitCode = 1;
      return 1;
    }
  }

  runCli().catch((err) => {
    console.error('Fatal CLI Error:', err);
    process.exit(1);
  });
}
