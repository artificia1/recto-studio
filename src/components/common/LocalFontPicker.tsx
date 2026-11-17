import { useEffect, useRef, useState } from 'preact/hooks';
import { listLocalFonts, loadLocalFont, localFontsSupported, type LocalFontFace, type LocalFontFamily } from '../../engine/localFonts';

const SHOWN = 200;

/**
 * Choose a font installed on this computer and load it like an imported font file. Families are
 * previewed in their own typeface, which the browser can draw because they are installed.
 */
export function LocalFontPicker({ onLoaded, label = 'Fonts on this computer…' }: {
  onLoaded: (family: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [families, setFamilies] = useState<LocalFontFamily[]>();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => () => { request.current++; }, []);
  useEffect(() => { if (open && families) search.current?.focus(); }, [open, families]);

  if (!localFontsSupported()) {
    return <p style={{ fontSize: '10px', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
      Fonts on this computer can be listed in Chrome or Edge. In this browser, import a font file.
    </p>;
  }

  const show = async () => {
    const ticket = ++request.current;
    setOpen(true); setError('');
    try {
      const list = await listLocalFonts();
      if (ticket === request.current) setFamilies(list);
    } catch (reason) {
      if (ticket === request.current) setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const choose = async (face: LocalFontFace) => {
    const ticket = ++request.current;
    setBusy(true); setError('');
    try {
      const family = await loadLocalFont(face);
      if (ticket !== request.current) return;
      setOpen(false); setQuery(''); setExpanded('');
      onLoaded(family);
    } catch (reason) {
      if (ticket === request.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (ticket === request.current) setBusy(false);
    }
  };

  const wanted = query.trim().toLocaleLowerCase();
  const matches = (families || []).filter(item => !wanted || item.family.toLocaleLowerCase().includes(wanted) ||
    item.faces.some(face => face.fullName.toLocaleLowerCase().includes(wanted)));

  if (!open) {
    return <button type="button" className="sm-btn" style={{ width: '100%', marginTop: '4px' }} onClick={() => void show()}
      title="Load a font installed on this computer. The browser asks once for permission to see your fonts.">{label}</button>;
  }

  return <div className="local-font-picker" role="dialog" aria-label="Fonts on this computer"
    style={{ border: '1px solid var(--border-color)', borderRadius: '4px', padding: '6px', marginTop: '4px', background: 'var(--bg-app)' }}>
    <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
      <input ref={search} type="search" aria-label="Search fonts on this computer" placeholder="Search installed fonts…"
        value={query} onInput={event => setQuery(event.currentTarget.value)}
        onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }}
        style={{ flex: '1 1 auto', minWidth: 0, width: 'auto', fontSize: '11px', padding: '4px 6px' }} />
      <button type="button" className="sm-btn" style={{ flex: '0 0 auto', width: 'auto' }} onClick={() => { request.current++; setOpen(false); setBusy(false); }}>Close</button>
    </div>
    {error && <p role="alert" style={{ color: '#ff7878', fontSize: '11px', margin: '4px 0' }}>{error}</p>}
    {!families && !error && <p style={{ fontSize: '11px', margin: '4px 0' }}>Reading the fonts on this computer…</p>}
    {families && <>
      <p style={{ fontSize: '10px', color: 'var(--text-secondary)', margin: '0 0 4px' }}>
        {matches.length} of {families.length} families{matches.length > SHOWN ? `; showing the first ${SHOWN}, type to narrow` : ''}.
        Choose a style to load it into this project.
      </p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: '240px', overflowY: 'auto' }}>
        {matches.slice(0, SHOWN).map(item => <li key={item.family}>
          <button type="button" aria-expanded={expanded === item.family}
            onClick={() => setExpanded(expanded === item.family ? '' : item.family)}
            style={{ display: 'flex', justifyContent: 'space-between', width: '100%', textAlign: 'left', background: 'none',
              border: 'none', borderBottom: '1px solid var(--border-color)', color: 'inherit', padding: '4px 2px', cursor: 'pointer' }}>
            <span style={{ fontFamily: `"${item.family}", var(--font-ui, sans-serif)`, fontSize: '13px' }}>{item.family}</span>
            <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{item.faces.length} {item.faces.length === 1 ? 'style' : 'styles'}</span>
          </button>
          {expanded === item.family && <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', padding: '4px 0 6px' }}>
            {item.faces.map(face => <button key={face.postscriptName || face.fullName} type="button" className="sm-btn" disabled={busy}
              title={face.fullName} onClick={() => void choose(face)}>{face.style || face.fullName}</button>)}
          </div>}
        </li>)}
      </ul>
      {busy && <p role="status" style={{ fontSize: '11px', margin: '4px 0 0' }}>Loading the font…</p>}
    </>}
  </div>;
}
