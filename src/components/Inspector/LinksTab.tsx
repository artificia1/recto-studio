import { useRef, useState } from 'preact/hooks';
import { stateManager } from '../../state';
import type { ProjectState } from '../../types';
import { lazy, Suspense } from 'preact/compat';
import { reviewPreflightChange } from '../../engine/preflightReview';
import { PreflightChangeSummary } from '../PreflightChangeSummary';
import type { readPlacedImage } from '../../engine/placedImage';
import BatchRelinkPanel from './BatchRelinkPanel';
import './linksTab.css';
const DataBindingsPanel = lazy(() => import('./DataBindingsPanel'));
const DocumentFontsPanel = lazy(() => import('./DocumentFontsPanel'));

interface LinksTabProps {
  state: ProjectState;
}

type AssetFilter = 'all' | 'missing' | 'warning';

export function LinksTab({ state }: LinksTabProps) {
  const links = stateManager.getAssetLinks();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const targetImage = useRef<ReturnType<typeof stateManager.getElementById>>();
  const relinkRequest = useRef(0);
  const [message, setMessage] = useState('');
  const [embedding, setEmbedding] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<AssetFilter>('all');
  const [preview, setPreview] = useState<{ id: string; revision: number; image: Awaited<ReturnType<typeof readPlacedImage>>;
    result: ReturnType<typeof reviewPreflightChange> }>();

  const filenameQuery = search.trim().toLowerCase();
  const matchingLinks = links.filter(link =>
    (filter === 'all' || link.status === filter) && link.name.toLowerCase().includes(filenameQuery));
  const missingCount = links.filter(link => link.status === 'missing').length;
  const lowResCount = links.filter(link => link.status === 'warning').length;

  const handleGoTo = (elementId: string) => {
    stateManager.zoomToElement(elementId);
  };

  const handleRelinkClick = (elementId: string) => {
    relinkRequest.current++;
    targetImage.current = stateManager.getElementById(elementId);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const image = targetImage.current;
    if (!file || !image) return;
    const request = ++relinkRequest.current;
    setPreview(undefined);
    const revision = stateManager.getDocumentRevision();
    try {
      const { readPlacedImage } = await import('../../engine/placedImage');
      const replacement = await readPlacedImage(file);
      if (request !== relinkRequest.current || targetImage.current !== image) return;
      if (stateManager.getDocumentRevision() !== revision || stateManager.getElementById(image.id) !== image) {
        throw new Error('The document changed. Select the replacement again.');
      }
      const snapshot = structuredClone(stateManager.getState());
      const target = snapshot.spreads.flatMap(spread => spread.elements).find(element => element.id === image.id);
      if (target?.type !== 'image' || target.locked || snapshot.layers.find(layer => layer.id === target.layerId)?.locked) {
        throw new Error('Unlock the image and its layer before relinking.');
      }
      Object.assign(target, replacement, { assetId: undefined, actualDpi: undefined, equation: undefined });
      setPreview({ id: target.id, revision, image: replacement,
        result: reviewPreflightChange(stateManager.runPreflightCheck(), stateManager.runPreflightCheck(snapshot)) });
      setMessage('');
    } catch (error) {
      if (request === relinkRequest.current && targetImage.current === image) setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="links-panel" style={{ padding: '4px 0' }}>
      <Suspense fallback={<p>Loading bound data tools…</p>}><DataBindingsPanel state={state}/></Suspense>
      <Suspense fallback={null}><DocumentFontsPanel state={state}/></Suspense>
      <button className="sm-btn" disabled={embedding} onClick={async () => {
        setEmbedding(true); setMessage('Embedding linked images…');
        try { const count = await stateManager.embedLinkedAssets(); setMessage(`${count} image(s) embedded. Newer image replacements and locked objects were preserved.`); }
        catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
        finally { setEmbedding(false); }
      }}>{embedding ? 'Embedding…' : 'Embed linked images'}</button>
      {message && <p role="status" style={{ fontSize: '11px', lineHeight: 1.5 }}>{message}</p>}
      {preview && <section aria-label="Image relink review">
        <p>Replacement: {preview.image.name}</p>
        <PreflightChangeSummary result={preview.result}/>
        <button className="sm-btn" onClick={() => {
          if (stateManager.getDocumentRevision() !== preview.revision) {
            setMessage('The document changed. Select the replacement again.');
            setPreview(undefined);
            return;
          }
          const { src, originalWidth, originalHeight, ...metadata } = preview.image;
          const changed = stateManager.relinkAsset(preview.id, src, { ...metadata, width: originalWidth, height: originalHeight });
          setMessage(changed ? 'Image relinked.' : 'The image frame changed or is locked.');
          setPreview(undefined);
        }}>Apply image relink</button>
        <button className="sm-btn" onClick={() => setPreview(undefined)}>Cancel image relink</button>
      </section>}
      {/* Hidden file input for relinking */}
      <input
        type="file"
        ref={fileInputRef}
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      <div className="placed-assets-heading">
        <h3>Placed assets</h3>
        <span role="status">{matchingLinks.length} of {links.length} shown</span>
      </div>
      {links.length > 0 && <BatchRelinkPanel />}
      {links.length > 0 && <div className="asset-filters">
        <label className="asset-filename-search">
          Search filenames
          <input type="search" value={search} onInput={event => setSearch(event.currentTarget.value)} />
        </label>
        <label>
          Status
          <select value={filter} onChange={event => setFilter(event.currentTarget.value as AssetFilter)}>
            <option value="all">All assets ({links.length})</option>
            <option value="missing">Missing source ({missingCount})</option>
            <option value="warning">Low resolution ({lowResCount})</option>
          </select>
        </label>
        <button type="button" className="sm-btn" disabled={!search && filter === 'all'} onClick={() => {
          setSearch('');
          setFilter('all');
        }}>Clear filters</button>
      </div>}

      {links.length === 0 ? (
        <div
          style={{
            padding: '24px 12px',
            textAlign: 'center',
            color: 'var(--text-secondary)',
            fontSize: '11px',
            background: 'var(--bg-app)',
            borderRadius: '6px',
            border: '1px dashed var(--border-color)',
          }}
        >
          <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
            No Placed Links
          </div>
          <div>Place an image on a page to see its link here.</div>
        </div>
      ) : matchingLinks.length === 0 ? (
        <p className="asset-empty-result">No assets match your search and status filter.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {matchingLinks.map((link) => {
            const isSelected = state.selectedElementId === link.elementId;
            return (
              <div
                key={link.id}
                style={{
                  background: isSelected ? '#1e293b' : 'var(--bg-app)',
                  border: isSelected ? '1px solid var(--accent-cyan)' : '1px solid var(--border-color)',
                  borderRadius: '6px',
                  padding: '8px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  transition: 'border-color 0.15s ease',
                }}
              >
                {/* Top Row: Thumbnail + Info */}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                  {/* Thumbnail */}
                  <div
                    style={{
                      width: '42px',
                      height: '42px',
                      borderRadius: '4px',
                      background: '#111',
                      border: '1px solid var(--border-color)',
                      overflow: 'hidden',
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {link.src ? (
                      <img
                        src={link.src}
                        alt={link.name}
                        loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <span style={{ fontSize: '11px', color: '#666', fontWeight: 600 }}>IMG</span>
                    )}
                  </div>

                  {/* Details */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '2px',
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: '11px',
                          color: 'var(--text-primary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: '130px',
                        }}
                        title={link.name}
                      >
                        {link.name}
                      </span>
                      <span
                        style={{
                          fontSize: '9px',
                          fontWeight: 700,
                          padding: '1px 4px',
                          borderRadius: '3px',
                          background: '#242424',
                          color: '#93c5fd',
                          border: '1px solid #334155',
                        }}
                      >
                        Pg {link.pageNumber}
                      </span>
                    </div>

                    {link.status !== 'missing' && <div style={{ fontSize: '10px', color: 'var(--text-secondary)', display: 'flex', gap: '6px' }}>
                      <span>{link.format}</span>
                      <span>·</span>
                      <span>{link.sizeFormatted}</span>
                      <span>·</span>
                      <span>{link.pixelWidth}×{link.pixelHeight}px</span>
                    </div>}
                  </div>
                </div>

                {/* Resolution & DPI Details */}
                {link.status === 'missing' ? (
                  <div className="asset-missing-status">Missing image source</div>
                ) : <div
                  style={{
                    background: '#141414',
                    borderRadius: '4px',
                    padding: '5px 8px',
                    fontSize: '10px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    border: '1px solid #282828',
                  }}
                >
                  <div>
                    <span style={{ color: 'var(--text-secondary)' }}>Effective: </span>
                    <span
                      style={{
                        fontWeight: 700,
                        color: link.isLowRes ? '#f59e0b' : '#10b981',
                      }}
                    >
                        {link.format.toUpperCase() === 'SVG' ? 'Vector' : `${link.effectiveDpi} DPI`}
                    </span>
                    <span style={{ color: '#666', fontSize: '9px', marginLeft: '4px' }}>
                        {link.format.toUpperCase() === 'SVG' ? '(scalable)' : `(Actual: ${link.actualDpi})`}
                    </span>
                  </div>

                  {link.isLowRes ? (
                    <span
                      style={{
                        color: '#f59e0b',
                        fontSize: '9px',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '2px',
                      }}
                    >
                      Low resolution
                    </span>
                  ) : null}
                </div>}

                {/* Scaled Frame Size */}
                <div style={{ fontSize: '9px', color: '#888', display: 'flex', justifyContent: 'space-between' }}>
                  <span>Frame Size: {Math.round(link.widthMm)} × {Math.round(link.heightMm)} mm</span>
                  <span>Spread {link.spreadNumber}</span>
                </div>

                {/* Actions row */}
                <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
                  <button
                    className="sm-btn"
                    style={{ flex: 1, padding: '3px 6px', fontSize: '10px', textAlign: 'center' }}
                    onClick={() => handleGoTo(link.elementId)}
                    title="Zoom and focus on element in canvas viewport"
                  >
                    Go to Element
                  </button>
                  <button
                    className="sm-btn"
                    style={{ flex: 1, padding: '3px 6px', fontSize: '10px', textAlign: 'center' }}
                    onClick={() => handleRelinkClick(link.elementId)}
                    title="Replace with new image file"
                  >
                    Relink...
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
