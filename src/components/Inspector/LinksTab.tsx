import { useRef, useState } from 'preact/hooks';
import { stateManager } from '../../state';
import { ProjectState, AssetLink } from '../../types';
import { lazy, Suspense } from 'preact/compat';
import { reviewPreflightChange } from '../../engine/preflightReview';
import { PreflightChangeSummary } from '../PreflightChangeSummary';
import type { readPlacedImage } from '../../engine/placedImage';
const DataBindingsPanel = lazy(() => import('./DataBindingsPanel'));
const DocumentFontsPanel = lazy(() => import('./DocumentFontsPanel'));

interface LinksTabProps {
  state: ProjectState;
}

export function LinksTab({ state }: LinksTabProps) {
  const links = stateManager.getAssetLinks();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const targetImage = useRef<ReturnType<typeof stateManager.getElementById>>();
  const relinkRequest = useRef(0);
  const [message, setMessage] = useState('');
  const [embedding, setEmbedding] = useState(false);
  const [preview, setPreview] = useState<{ id: string; revision: number; image: Awaited<ReturnType<typeof readPlacedImage>>;
    result: ReturnType<typeof reviewPreflightChange> }>();

  const lowResCount = links.filter((l) => l.isLowRes).length;

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

      {/* Header bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px',
          paddingBottom: '8px',
          borderBottom: '1px solid var(--border-color)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Placed Assets ({links.length})
          </span>
          {lowResCount > 0 && (
            <span
              style={{
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#ef4444',
                border: '1px solid #ef4444',
                fontSize: '9px',
                fontWeight: 700,
                padding: '1px 5px',
                borderRadius: '3px',
              }}
              title={`${lowResCount} image(s) below 250 DPI print resolution threshold`}
            >
              {lowResCount} Low-Res
            </span>
          )}
        </div>
      </div>

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
          <div>Drag & drop photos onto pages or image frames to populate asset intelligence.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {links.map((link) => {
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

                    <div style={{ fontSize: '10px', color: 'var(--text-secondary)', display: 'flex', gap: '6px' }}>
                      <span>{link.format}</span>
                      <span>·</span>
                      <span>{link.sizeFormatted}</span>
                      <span>·</span>
                      <span>{link.pixelWidth}×{link.pixelHeight}px</span>
                    </div>
                  </div>
                </div>

                {/* Resolution & DPI Details */}
                <div
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
                      [Low-Res]
                    </span>
                  ) : (
                    <span
                      style={{
                        color: '#10b981',
                        fontSize: '9px',
                        fontWeight: 700,
                      }}
                    >
                      [300 DPI Print]
                    </span>
                  )}
                </div>

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
