import { useEffect, useRef, useState } from 'preact/hooks';
import { fontManager } from '../../fontManager';
import type { readFontCollection } from '../../engine/fontCollection';

export const FONT_FILES = '.ttf,.otf,.woff,.woff2,.ttc,.otc';
type Collection = ReturnType<typeof readFontCollection>;

export function useFontFileImport(onLoaded: (family: string) => void) {
  const request = useRef(0);
  const [collection, setCollection] = useState<Collection>();
  const [face, setFace] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { request.current++; }, []);

  const run = async (action: () => Promise<string | undefined>) => {
    const ticket = ++request.current;
    setError('');
    setBusy(true);
    try {
      const family = await action();
      if (family && ticket === request.current) onLoaded(family);
    } catch (reason) {
      if (ticket === request.current) setError(reason instanceof Error ? reason.message : 'Unable to load this font file.');
    } finally {
      if (ticket === request.current) setBusy(false);
    }
  };
  const importFile = (file: File) => {
    setCollection(undefined);
    setFace(0);
    return run(async () => {
      const ticket = request.current;
      if (file.size > 32 * 1024 * 1024) throw new Error('Choose a font file up to 32 MiB.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (ticket !== request.current) return;
      if (bytes[0] === 116 && bytes[1] === 116 && bytes[2] === 99 && bytes[3] === 102) {
        const { readFontCollection } = await import('../../engine/fontCollection');
        if (ticket === request.current) setCollection(readFontCollection(bytes, file.name));
      } else return fontManager.registerFontBuffer(file.name, bytes);
    });
  };
  const choice = collection && <div className="publication-actions">
    <label>Collection face<select value={face} disabled={busy} onChange={event => setFace(Number(event.currentTarget.value))}>
      {collection.faces.map((name, index) => <option key={index} value={index}>{name}</option>)}
    </select></label>
    <button type="button" className="sm-btn" disabled={busy} onClick={() => void run(async () => {
      const ticket = request.current;
      const selected = collection.extract(face);
      const family = await fontManager.registerFontBuffer(selected.fileName, selected.bytes);
      if (ticket === request.current) setCollection(undefined);
      return family;
    })}>Import selected face</button>
  </div>;
  return { importFile, choice, error, busy };
}
