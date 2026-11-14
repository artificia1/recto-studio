import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, realpath, rm, rmdir, stat } from 'node:fs/promises';
import path from 'node:path';

const maxFilenameLength = 1024;
export const limits = {
  project: 32 * 1024 * 1024,
  dataset: 4 * 1024 * 1024,
  exchange: 16 * 1024 * 1024,
  image: 16 * 1024 * 1024,
  pdf: 64 * 1024 * 1024,
  batch: 128 * 1024 * 1024,
  records: 100,
  pages: 500,
};

export const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
type OutputFile = { name: string; bytes: Uint8Array };

/** All tool paths are relative to the directory chosen by the operator at launch. */
export class PublishingWorkspace {
  private constructor(private readonly root: string, readonly writable: boolean) {}

  static async open(directory: string, writable: boolean) {
    const root = await realpath(directory);
    if (!(await stat(root)).isDirectory()) throw new Error('Choose an existing project directory.');
    return new PublishingWorkspace(root, writable);
  }

  assertWritable() {
    if (!this.writable) throw new Error('This server is read-only. Start it with --allow-write to save drafts or exports.');
  }

  private components(input: string, extensions?: readonly string[]) {
    const parts = input.split('/');
    if (input.length > maxFilenameLength || parts.some(part =>
      !part || part === '.' || part === '..' || /[\\:<>"|?*\u0000-\u001f\u007f]|[. ]$/u.test(part) ||
      /^(?:CON|PRN|AUX|NUL|COM[0-9¹²³]|LPT[0-9¹²³])(?:\.|$)/i.test(part))) {
      throw new Error('Use a workspace-relative path with forward slashes and ordinary file names.');
    }
    if (extensions && !extensions.includes(path.extname(parts.at(-1)!).toLowerCase())) {
      throw new Error(`Expected a ${extensions.join(' or ')} file.`);
    }
    return parts;
  }

  private async existing(parts: string[]) {
    let current = this.root;
    for (const part of parts) {
      current = path.join(current, part);
      const entry = await lstat(current).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') throw new Error('A selected file or parent folder is missing.');
        throw error;
      });
      if (entry.isSymbolicLink()) throw new Error('Symbolic links and junctions cannot be used in the workspace.');
    }
    const resolved = await realpath(current);
    const relative = path.relative(this.root, resolved);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      throw new Error('The selected path is outside the publishing workspace.');
    }
    return resolved;
  }

  async read(name: string, extensions: readonly string[], limit: number) {
    const file = await this.existing(this.components(name, extensions));
    if (!(await lstat(file)).isFile()) throw new Error('Choose a regular file.');
    const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const handle = await open(file, flags);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > limit) throw new Error('The selected file exceeds the supported size or is not a regular file.');
      if (info.nlink > 1) throw new Error('Choose a regular workspace file without hard links.');
      const blocks: Buffer[] = [];
      let length = 0;
      const stream = handle.createReadStream({ autoClose: false, end: limit });
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        length += chunk.length;
        if (length > limit) throw new Error('The selected file exceeds the supported size.');
        blocks.push(chunk);
      }
      return Buffer.concat(blocks, length);
    } finally { await handle.close(); }
  }

  private async outputPath(name: string, extensions?: readonly string[]) {
    this.assertWritable();
    const parts = this.components(name, extensions);
    const filename = parts.pop()!;
    const parent = await this.existing(parts);
    if (!(await stat(parent)).isDirectory()) throw new Error('The output parent must be an existing directory.');
    const target = path.join(parent, filename);
    try { await lstat(target); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return target; throw error; }
    throw new Error('The output already exists. Choose a new name.');
  }

  async checkOutput(name: string, extension?: string) {
    await this.outputPath(name, extension ? [extension] : undefined);
  }

  private async writeOne(target: string, bytes: Uint8Array) {
    const temporary = path.join(path.dirname(target), `.recto-${randomUUID()}.tmp`);
    const handle = await open(temporary, 'wx', 0o600);
    try {
      try { await handle.writeFile(bytes); await handle.sync(); }
      finally { await handle.close(); }
      try { await link(temporary, target); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('The output already exists. Choose a new name.');
        throw error;
      }
    } finally { await rm(temporary, { force: true }); }
  }

  async write(name: string, extension: string, bytes: Uint8Array) {
    await this.writeOne(await this.outputPath(name, [extension]), bytes);
    return { path: name, bytes: bytes.byteLength, sha256: sha256(bytes) };
  }

  async writeBatch(directory: string, files: OutputFile[]) {
    const target = await this.outputPath(directory);
    const entries = files.map(file => {
      const parts = this.components(file.name);
      if (parts.length !== 1) throw new Error('Batch files need simple names.');
      return { ...file, path: `${directory}/${file.name}` };
    });
    await mkdir(target, { mode: 0o700 });
    const written: string[] = [];
    try {
      for (const entry of entries) {
        const destination = path.join(target, entry.name);
        await this.writeOne(destination, entry.bytes);
        written.push(destination);
      }
    } catch (error) {
      for (const file of written) await rm(file, { force: true }).catch(() => {});
      await rmdir(target).catch(() => {});
      throw error;
    }
    return entries.map(({ path: file, bytes }) => ({ path: file, bytes: bytes.byteLength, sha256: sha256(bytes) }));
  }
}
