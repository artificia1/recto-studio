import { createReadStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseMergeData, substituteElementTokens, substituteTokens } from '../src/dataMerge.js';
import { exportDocumentToPdf } from '../src/export/pdfExport.js';
import { PDF_PRESETS } from '../src/export/presets.js';
import { parseProject } from '../src/state/projectValidation.js';
import { INITIAL_STATE } from '../src/state/defaults.js';

const DATA_LIMIT = 4 * 1024 * 1024;
const PROJECT_LIMIT = 50 * 1024 * 1024;

async function readBounded(source, limit) {
  const input = source === '-' ? process.stdin : createReadStream(source);
  const chunks = [];
  let size = 0;
  for await (const chunk of input) {
    size += chunk.length;
    if (size > limit) throw new Error(`Input exceeds ${limit / 1024 / 1024} MiB.`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function renderArguments(args) {
  const [project, ...flags] = args;
  if (!project || project.startsWith('--')) throw new Error('Specify a .recto template for recto render.');
  const options = { project, editions: [], preset: 'print' };
  const accepted = new Set(['data', 'output', 'edition', 'preset', 'importer']);
  for (let index = 0; index < flags.length; index++) {
    const match = /^--([a-z]+)(?:=(.*))?$/.exec(flags[index]);
    if (!match || !accepted.has(match[1])) throw new Error(`Unknown render option ${flags[index]}.`);
    const value = match[2] ?? flags[++index];
    if (!value || value.startsWith('--')) throw new Error(`--${match[1]} needs a value.`);
    if (match[1] === 'edition') options.editions.push(value);
    else options[match[1]] = value;
  }
  if (!options.data || !options.output) throw new Error('Provide --data and a new --output directory.');
  if (!Object.hasOwn(PDF_PRESETS, options.preset)) throw new Error(`Unknown PDF preset ${options.preset}.`);
  return options;
}

async function loadRecords(options) {
  const data = await readBounded(options.data, DATA_LIMIT);
  if (!options.importer) return parseMergeData(data.toString('utf8')).records;
  // Modules execute with the same permissions as this CLI. Only an explicit
  // local --importer argument can select a module; project files cannot load one.
  const moduleUrl = pathToFileURL(path.resolve(options.importer));
  const { default: importer } = await import(moduleUrl.href);
  if (importer?.apiVersion !== 1 || typeof importer.parseRecords !== 'function') throw new Error('The importer must implement the Recto dataset importer v1 API.');
  const records = await importer.parseRecords({ bytes: new Uint8Array(data), filename: path.basename(options.data) });
  if (!Array.isArray(records)) throw new Error('A dataset importer must return an array of records.');
  return parseMergeData(JSON.stringify(records)).records;
}

export async function renderBatch(args) {
  const options = renderArguments(args);
  const template = parseProject((await readBounded(options.project, PROJECT_LIMIT)).toString('utf8'), INITIAL_STATE);
  for (const name of options.editions) if (!template.conditions?.some(condition => condition.name === name)) throw new Error(`Unknown edition “${name}”.`);
  if (options.editions.length) for (const condition of template.conditions || []) condition.visible = options.editions.includes(condition.name);
  const records = await loadRecords(options);
  if (!records.length || records.length > 10000) throw new Error('Render needs between 1 and 10,000 records.');

  const destination = path.resolve(options.output);
  try {
    await lstat(destination);
    throw new Error('The output path already exists. Choose a new batch directory.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(path.dirname(destination), { recursive: true });
  const staging = await mkdtemp(path.join(path.dirname(destination), '.recto-render-'));
  const files = [];
  const warnings = new Set();
  try {
    for (const [index, record] of records.entries()) {
      const project = structuredClone(template);
      project.settings.title = substituteTokens(project.settings.title, record);
      for (const spread of [...project.spreads, ...project.masterSpreads]) spread.elements = spread.elements.map(element => substituteElementTokens(element, record));
      const filename = `record-${String(index + 1).padStart(5, '0')}.pdf`;
      try {
        const pdf = await exportDocumentToPdf(project, { ...PDF_PRESETS[options.preset].options, download: false, strict: true,
          fetchExternalAssets: false, onWarning: warning => warnings.add(warning) });
        files.push(filename);
        await writeFile(path.join(staging, filename), Buffer.from(pdf.output('arraybuffer')), { flag: 'wx' });
      } catch (error) {
        throw new Error(`Record ${index + 1} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const manifest = JSON.stringify({ version: 1, preset: options.preset, editions: options.editions, files, warnings: [...warnings] }, null, 2);
    files.push('manifest.json');
    await writeFile(path.join(staging, 'manifest.json'), manifest, { flag: 'wx' });
    await rename(staging, destination);
  } catch (error) {
    // Clean only files we created and the empty staging directory.
    for (const name of files) await unlink(path.join(staging, name)).catch(() => {});
    await rmdir(staging).catch(() => {});
    throw error;
  }
  console.log(`Rendered ${records.length} PDFs to ${destination}`);
}
