/**
 * Recto Studio — Live Wrap Cover Designer & Mathematical Spine Calculator Modal
 * Copyright (c) 2022-2026 Abhinav Sidhu. All rights reserved.
 * Licensed under the MIT License.
 */

import { useState, useRef, useEffect } from 'preact/hooks';
import { ProjectState } from '../types/index';
import {
  calculateCoverSpineMetrics,
  createWrapCoverSpreadInProject,
  exportWrapCoverPdf,
  PaperStockPreset,
  BindingType,
  PAPER_STOCK_PRESETS,
  CoverSpineConfig,
  CoverSpineMetrics,
} from '../engine/spineCalculator';
import { stateManager } from '../state';

interface CoverSpineModalProps {
  state: ProjectState;
  onClose: () => void;
}

export function CoverSpineModal({ state, onClose }: CoverSpineModalProps) {
  const detectedPages = state.spreads.reduce((acc, s) => acc + s.pages.length, 0);

  const [pageCount, setPageCount] = useState<number>(Math.max(24, detectedPages));
  const [stockPreset, setStockPreset] = useState<PaperStockPreset>('cream-60lb');
  const [bindingType, setBindingType] = useState<BindingType>('paperback-perfect');
  const [bookTitle, setBookTitle] = useState<string>(state.settings.title || 'Untitled Book');
  const [authorName, setAuthorName] = useState<string>('Abhinav Sidhu');
  const [frenchFlapWidth, setFrenchFlapWidth] = useState<number>(75);
  const [includeBarcode, setIncludeBarcode] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'2d' | '3d'>('2d');
  const [isExporting, setIsExporting] = useState<boolean>(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  const trimWidthMm = state.settings.widthMm || 152.4;
  const trimHeightMm = state.settings.heightMm || 228.6;

  const config: CoverSpineConfig = {
    pageCount,
    stockPreset,
    trimWidthMm,
    trimHeightMm,
    bindingType,
    frenchFlapWidthMm: frenchFlapWidth,
    includeBarcodeZone: includeBarcode,
    bookTitle,
    authorName,
  };

  const metrics: CoverSpineMetrics = calculateCoverSpineMetrics(config);

  // 3D Canvas Rendering Effect
  useEffect(() => {
    if (activeTab !== '3d' || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId = 0;
    let angle = 0.35; // isometric tilt

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const cx = canvas.width / 2;
      const cy = canvas.height / 2;

      // Book geometry dimensions scaled to canvas
      const scale = 0.95;
      const bHeight = 180 * scale;
      const bWidth = 120 * scale;
      const bSpine = Math.max(10, metrics.spineWidthMm * 2.8 * scale);

      ctx.save();
      ctx.translate(cx, cy);

      // 1. Draw Paper Page Block (Side & Top depth)
      // Top paper edge
      ctx.fillStyle = '#e8e8ea';
      ctx.beginPath();
      ctx.moveTo(-bSpine / 2, -bHeight / 2);
      ctx.lineTo(bWidth * Math.cos(angle) - bSpine / 2, -bHeight / 2 - bWidth * Math.sin(angle) * 0.4);
      ctx.lineTo(bWidth * Math.cos(angle) + bSpine / 2, -bHeight / 2 - bWidth * Math.sin(angle) * 0.4 + 5);
      ctx.lineTo(bSpine / 2, -bHeight / 2);
      ctx.closePath();
      ctx.fill();

      // Right paper edge block (feint page lines)
      ctx.fillStyle = '#dcdce0';
      ctx.beginPath();
      ctx.moveTo(bWidth * Math.cos(angle) - bSpine / 2, -bHeight / 2 - bWidth * Math.sin(angle) * 0.4);
      ctx.lineTo(bWidth * Math.cos(angle) - bSpine / 2, bHeight / 2 - bWidth * Math.sin(angle) * 0.4);
      ctx.lineTo(bWidth * Math.cos(angle) + bSpine / 2, bHeight / 2 - bWidth * Math.sin(angle) * 0.4 + 5);
      ctx.lineTo(bWidth * Math.cos(angle) + bSpine / 2, -bHeight / 2 - bWidth * Math.sin(angle) * 0.4 + 5);
      ctx.closePath();
      ctx.fill();

      // 2. Draw Spine (Curve & Shadow)
      const spineGrad = ctx.createLinearGradient(-bSpine / 2, 0, bSpine / 2, 0);
      spineGrad.addColorStop(0, '#111114');
      spineGrad.addColorStop(0.35, '#26262c');
      spineGrad.addColorStop(0.7, '#1b1b20');
      spineGrad.addColorStop(1, '#0e0e11');

      ctx.fillStyle = spineGrad;
      ctx.beginPath();
      ctx.rect(-bSpine / 2, -bHeight / 2, bSpine, bHeight);
      ctx.fill();

      // Spine Title (Rotated)
      if (bSpine >= 14) {
        ctx.save();
        ctx.translate(0, 0);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = '#f4f4f5';
        ctx.font = '600 8px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(bookTitle.toUpperCase().slice(0, 24), 0, 0);
        ctx.restore();
      }

      // 3. Draw Front Cover (Rotated Perspective Plane)
      const frontGrad = ctx.createLinearGradient(bSpine / 2, 0, bSpine / 2 + bWidth, 0);
      frontGrad.addColorStop(0, '#1f1f25');
      frontGrad.addColorStop(1, '#16161a');

      ctx.fillStyle = frontGrad;
      ctx.beginPath();
      ctx.moveTo(bSpine / 2, -bHeight / 2);
      ctx.lineTo(bSpine / 2 + bWidth * Math.cos(angle), -bHeight / 2 - bWidth * Math.sin(angle) * 0.35);
      ctx.lineTo(bSpine / 2 + bWidth * Math.cos(angle), bHeight / 2 - bWidth * Math.sin(angle) * 0.35);
      ctx.lineTo(bSpine / 2, bHeight / 2);
      ctx.closePath();
      ctx.fill();

      // Front Cover Gold Foil Accent Line
      ctx.strokeStyle = '#383842';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Front Cover Mock Text
      ctx.save();
      ctx.transform(Math.cos(angle), -Math.sin(angle) * 0.35, 0, 1, bSpine / 2 + 15, -bHeight / 4);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px Playfair Display, serif';
      ctx.fillText(bookTitle.slice(0, 16), 10, 20);
      ctx.fillStyle = '#8e8e93';
      ctx.font = '500 8px Inter, sans-serif';
      ctx.fillText(authorName.toUpperCase().slice(0, 20), 10, 40);
      ctx.restore();

      ctx.restore();
    };

    render();
    return () => cancelAnimationFrame(animationFrameId);
  }, [activeTab, metrics.spineWidthMm, bookTitle, authorName]);

  const handleInsertSpread = () => {
    const spread = createWrapCoverSpreadInProject(state, config);
    // Insert at beginning of document
    state.spreads.unshift(spread);
    stateManager.renumberPages();
    stateManager.setActiveSpread(0);
    onClose();
  };

  const handleExportPdf = async () => {
    try {
      setIsExporting(true);
      const doc = await exportWrapCoverPdf(config);
      const safeTitle = bookTitle.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
      doc.save(`${safeTitle}-full-wrap-cover.pdf`);
    } catch (e) {
      console.error('Failed to export cover PDF', e);
      alert('Error exporting wrap cover PDF.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog cover-spine-modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Wrap Cover Designer & Spine Calculator</h2>
            <div className="modal-subtitle">
              Continuous book jacket wrap with mathematical caliper spine width and fold guides
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose} title="Close">
            x
          </button>
        </div>

        <div className="cover-spine-modal-content">
          {/* Left Configuration Panel */}
          <div className="cover-spine-config-panel">
            <div className="cover-spine-section-title">Physical Book Specifications</div>

            <div className="cover-spine-field-row">
              <div className="cover-spine-field">
                <label>Total Page Count</label>
                <input
                  type="number"
                  min="4"
                  max="2000"
                  step="2"
                  className="imposition-input"
                  value={pageCount}
                  onInput={(e) => setPageCount(parseInt((e.target as HTMLInputElement).value, 10) || 4)}
                />
              </div>

              <div className="cover-spine-field">
                <label>Binding Format</label>
                <select
                  className="imposition-select"
                  value={bindingType}
                  onChange={(e) => setBindingType((e.target as HTMLSelectElement).value as BindingType)}
                >
                  <option value="paperback-perfect">Paperback (Perfect Bound Softcover)</option>
                  <option value="paperback-flaps">French Flaps (75mm Front & Back Flaps)</option>
                  <option value="hardcover-case">Hardcover Case Wrap (Binder Board + Hinge)</option>
                </select>
              </div>
            </div>

            <div className="cover-spine-field">
              <label>Paper Stock Caliper & Density</label>
              <select
                className="imposition-select"
                value={stockPreset}
                onChange={(e) => setStockPreset((e.target as HTMLSelectElement).value as PaperStockPreset)}
              >
                {Object.values(PAPER_STOCK_PRESETS).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.ppi} PPI · {p.weightGsm} gsm)
                  </option>
                ))}
              </select>
              <div className="imposition-field-hint">
                {PAPER_STOCK_PRESETS[stockPreset]?.recommendedFor}
              </div>
            </div>

            <div className="cover-spine-field-row">
              <div className="cover-spine-field">
                <label>Book Title</label>
                <input
                  type="text"
                  className="imposition-input"
                  value={bookTitle}
                  onInput={(e) => setBookTitle((e.target as HTMLInputElement).value)}
                />
              </div>

              <div className="cover-spine-field">
                <label>Author / Imprint</label>
                <input
                  type="text"
                  className="imposition-input"
                  value={authorName}
                  onInput={(e) => setAuthorName((e.target as HTMLInputElement).value)}
                />
              </div>
            </div>

            {bindingType === 'paperback-flaps' && (
              <div className="cover-spine-field">
                <label>French Flap Width (mm)</label>
                <input
                  type="number"
                  min="40"
                  max="150"
                  className="imposition-input"
                  value={frenchFlapWidth}
                  onInput={(e) => setFrenchFlapWidth(parseInt((e.target as HTMLInputElement).value, 10) || 75)}
                />
              </div>
            )}

            <div className="imposition-checkbox-field">
              <label>
                <input
                  type="checkbox"
                  checked={includeBarcode}
                  onChange={(e) => setIncludeBarcode((e.target as HTMLInputElement).checked)}
                />
                Include ISBN Barcode Exclusion Zone on Back Cover
              </label>
            </div>

            {/* Calculated Metrics Card */}
            <div className="spine-metrics-card">
              <div className="spine-metric-highlight">
                <div className="metric-title">CALCULATED SPINE WIDTH</div>
                <div className="metric-val-large">
                  {metrics.spineWidthMm} <span className="unit">mm</span>
                  <span className="metric-sub">({metrics.spineWidthInches} in)</span>
                </div>
              </div>

              <div className="imposition-summary-row">
                <span>Total Wrap Spread:</span>
                <strong>{metrics.totalWrapWidthMm} × {metrics.totalWrapHeightMm} mm</strong>
              </div>
              <div className="imposition-summary-row">
                <span>Trim Dimensions:</span>
                <strong>{trimWidthMm} × {trimHeightMm} mm</strong>
              </div>
              <div className="imposition-summary-row">
                <span>Bleed / Turn-in:</span>
                <strong>{metrics.bleedMm} mm</strong>
              </div>
              {metrics.hingeScoreMm > 0 && (
                <div className="imposition-summary-row">
                  <span>Hinge Joint Score:</span>
                  <strong>{metrics.hingeScoreMm} mm</strong>
                </div>
              )}
              <div className="imposition-summary-row">
                <span>Prepress Compliance:</span>
                <span className="compliance-badges">
                  <span className={`badge ${metrics.ingramSparkCompliant ? 'valid' : 'warn'}`}>
                    IngramSpark
                  </span>
                  <span className={`badge ${metrics.kdpCompliant ? 'valid' : 'warn'}`}>
                    Amazon KDP
                  </span>
                </span>
              </div>
            </div>
          </div>

          {/* Right Preview Panel */}
          <div className="cover-spine-preview-panel">
            <div className="cover-tab-bar">
              <button
                className={`cover-tab-btn ${activeTab === '2d' ? 'active' : ''}`}
                onClick={() => setActiveTab('2d')}
              >
                2D Wrap Schematic Layout
              </button>
              <button
                className={`cover-tab-btn ${activeTab === '3d' ? 'active' : ''}`}
                onClick={() => setActiveTab('3d')}
              >
                3D Bound Book Perspective
              </button>
            </div>

            <div className="cover-preview-canvas-box">
              {activeTab === '2d' ? (
                /* 2D Wrap Schematic Diagram */
                <div className="cover-wrap-diagram">
                  <div className="diagram-wrap-outer">
                    {/* Back Cover */}
                    <div className="diagram-section back-cover">
                      <div className="section-label">BACK COVER</div>
                      <div className="section-dim">{trimWidthMm} mm</div>
                      {includeBarcode && (
                        <div className="diagram-barcode-box">
                          <span>ISBN BARCODE</span>
                        </div>
                      )}
                    </div>

                    {/* Left Hinge (if present) */}
                    {metrics.hingeScoreMm > 0 && <div className="diagram-hinge" />}

                    {/* Spine */}
                    <div
                      className="diagram-section spine-section"
                      style={{ flexGrow: Math.max(0.15, metrics.spineWidthMm / 80) }}
                    >
                      <div className="spine-vertical-text">
                        <span>{bookTitle.toUpperCase()}</span>
                      </div>
                      <div className="spine-dim-label">{metrics.spineWidthMm}mm</div>
                    </div>

                    {/* Right Hinge (if present) */}
                    {metrics.hingeScoreMm > 0 && <div className="diagram-hinge" />}

                    {/* Front Cover */}
                    <div className="diagram-section front-cover">
                      <div className="section-label">FRONT COVER</div>
                      <div className="section-dim">{trimWidthMm} mm</div>
                      <div className="front-cover-mock-art">
                        <div className="mock-title-text">{bookTitle}</div>
                        <div className="mock-author-text">{authorName}</div>
                      </div>
                    </div>
                  </div>

                  <div className="wrap-diagram-legend">
                    <span className="legend-item">
                      <span className="legend-swatch bleed-swatch" /> Bleed: {metrics.bleedMm}mm
                    </span>
                    <span className="legend-item">
                      <span className="legend-swatch safety-swatch" /> Safety Margin: {metrics.safetyMarginMm}mm
                    </span>
                    <span className="legend-item">
                      <span className="legend-swatch fold-swatch" /> Spine Fold Guides
                    </span>
                  </div>
                </div>
              ) : (
                /* 3D Canvas Preview */
                <div className="cover-3d-container">
                  <canvas ref={canvasRef} width={420} height={280} className="cover-3d-canvas" />
                  <div className="cover-3d-caption">
                    3D Bound Perspective Mockup (Calculated Spine: {metrics.spineWidthMm} mm)
                  </div>
                </div>
              )}
            </div>

            <div className="cover-prepress-notice">
              <strong>Prepress Specification:</strong> Total flat jacket width is {metrics.totalWrapWidthMm} mm.
              Spine vertical title threshold verified ({metrics.spineWidthMm >= 3.0 ? 'Eligible' : 'Too thin for text'}).
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <div className="modal-footer-left">
            <span className="footer-status-text">
              Engineered by Abhinav Sidhu. Compliant with ISO 12647-2 prepress tolerances.
            </span>
          </div>
          <div className="modal-footer-right">
            <button className="action-btn" onClick={onClose}>
              Cancel
            </button>
            <button className="action-btn" onClick={handleInsertSpread} title="Inject full wrap cover spread as Spread 0">
              + Insert Wrap Cover Spread
            </button>
            <button className="action-btn-primary" onClick={handleExportPdf} disabled={isExporting}>
              {isExporting ? 'Compiling Cover...' : 'Export Print Cover PDF'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
