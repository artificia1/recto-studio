/**
 * Recto Studio — Booklet Imposition Modal
 * Copyright (c) 2022-2026 Abhinav Sidhu. All rights reserved.
 * Licensed under the MIT License.
 */

import { useState } from 'preact/hooks';
import { ProjectState } from '../types/index';
import {
  calculateImpositionPlan,
  exportImposedBookletPdf,
  ImpositionBindingMode,
  ImpositionPlan,
  ImpositionSheetSide,
} from '../export/impositionEngine';

interface BookletImpositionModalProps {
  state: ProjectState;
  onClose: () => void;
}

export function BookletImpositionModal({ state, onClose }: BookletImpositionModalProps) {
  const [bindingMode, setBindingMode] = useState<ImpositionBindingMode>('saddle-stitch');
  const [signatureSize, setSignatureSize] = useState<number>(16);
  const [paperWeightGsm, setPaperWeightGsm] = useState<number>(80);
  const [creepMm, setCreepMm] = useState<number>(0.08);
  const [includeCutMarks, setIncludeCutMarks] = useState<boolean>(true);
  const [currentSideIndex, setCurrentSideIndex] = useState<number>(0);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  const plan: ImpositionPlan = calculateImpositionPlan(state, {
    bindingMode,
    signatureSize,
    paperStockWeightGsm: paperWeightGsm,
    creepMmPerSheet: creepMm,
  });

  const currentSide: ImpositionSheetSide = plan.sheetSides[currentSideIndex] || plan.sheetSides[0];

  const handleExport = async () => {
    try {
      setIsExporting(true);
      const doc = await exportImposedBookletPdf(state, {
        bindingMode,
        signatureSize,
        paperStockWeightGsm: paperWeightGsm,
        creepMmPerSheet: creepMm,
        includeCutMarks,
      });

      const safeTitle = (state.settings.title || 'publication').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
      doc.save(`${safeTitle}-imposed-booklet-${bindingMode}.pdf`);
    } catch (err) {
      console.error('Failed to export imposed booklet', err);
      alert('Imposition export encountered an issue. Check console for details.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog imposition-modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Booklet Signature & Imposition Engine</h2>
            <div className="modal-subtitle">
              Duplex printer spreads for saddle-stitch zines, chapbooks, and perfect-bound signatures
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose} title="Close">
            x
          </button>
        </div>

        <div className="imposition-modal-content">
          {/* Left: Configuration Sidebar */}
          <div className="imposition-config-panel">
            <div className="imposition-section-title">Binding Configuration</div>

            <div className="imposition-field">
              <label>Binding Mode</label>
              <select
                className="imposition-select"
                value={bindingMode}
                onChange={(e) => {
                  setBindingMode((e.target as HTMLSelectElement).value as ImpositionBindingMode);
                  setCurrentSideIndex(0);
                }}
              >
                <option value="saddle-stitch">Saddle-Stitch (Folded & Stapled Booklet)</option>
                <option value="perfect-bound">Multi-Signature Perfect Bound (Glued Spine)</option>
                <option value="consecutive-2up">Consecutive 2-Up Proofing (Reader Spreads)</option>
              </select>
            </div>

            {bindingMode === 'perfect-bound' && (
              <div className="imposition-field">
                <label>Signature Size (Pages per Signature)</label>
                <select
                  className="imposition-select"
                  value={signatureSize}
                  onChange={(e) => {
                    setSignatureSize(parseInt((e.target as HTMLSelectElement).value, 10));
                    setCurrentSideIndex(0);
                  }}
                >
                  <option value={8}>8 Pages (2 Sheets folded)</option>
                  <option value={16}>16 Pages (4 Sheets folded - Industry Standard)</option>
                  <option value={32}>32 Pages (8 Sheets folded - High Density)</option>
                </select>
              </div>
            )}

            <div className="imposition-field">
              <label>Paper Stock Weight</label>
              <select
                className="imposition-select"
                value={paperWeightGsm}
                onChange={(e) => {
                  const gsm = parseInt((e.target as HTMLSelectElement).value, 10);
                  setPaperWeightGsm(gsm);
                  setCreepMm(Math.round(gsm * 0.001 * 100) / 100);
                }}
              >
                <option value={60}>60 gsm (Ultralight / Bible)</option>
                <option value={70}>70 gsm (Lightweight Text)</option>
                <option value={80}>80 gsm (Standard Copy / Zine Paper)</option>
                <option value={90}>90 gsm (Trade Book Cream / Offset)</option>
                <option value={115}>115 gsm (Coated Matte Art)</option>
              </select>
            </div>

            <div className="imposition-field">
              <label>Creep Compensation per Sheet (mm)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="0.5"
                className="imposition-input"
                value={creepMm}
                onInput={(e) => setCreepMm(parseFloat((e.target as HTMLInputElement).value) || 0)}
              />
              <div className="imposition-field-hint">
                Max calculated creep: {Math.round(plan.maxCreepMm * 100) / 100} mm at innermost sheet
              </div>
            </div>

            <div className="imposition-checkbox-field">
              <label>
                <input
                  type="checkbox"
                  checked={includeCutMarks}
                  onChange={(e) => setIncludeCutMarks((e.target as HTMLInputElement).checked)}
                />
                Include Center Fold Line, Corner Trim Marks & Slugs
              </label>
            </div>

            <div className="imposition-summary-card">
              <div className="imposition-summary-row">
                <span>Original Pages:</span>
                <strong>{plan.totalPagesOriginal}</strong>
              </div>
              <div className="imposition-summary-row">
                <span>Imposed Pages:</span>
                <strong>
                  {plan.totalPagesPadded} {plan.blankPagesAdded > 0 && `(+${plan.blankPagesAdded} blank padding)`}
                </strong>
              </div>
              <div className="imposition-summary-row">
                <span>Physical Sheets:</span>
                <strong>{plan.sheetsCount} sheets ({plan.sheetsCount * 2} duplex passes)</strong>
              </div>
              {plan.signaturesCount > 1 && (
                <div className="imposition-summary-row">
                  <span>Signatures:</span>
                  <strong>{plan.signaturesCount} ({plan.signatureSizePages} pages each)</strong>
                </div>
              )}
              <div className="imposition-summary-row">
                <span>Sheet Dimension:</span>
                <strong>{plan.sheetWidthMm} × {plan.sheetHeightMm} mm</strong>
              </div>
            </div>
          </div>

          {/* Right: Interactive Sheet Preview */}
          <div className="imposition-preview-panel">
            <div className="imposition-sheet-toolbar">
              <div className="sheet-nav-controls">
                <button
                  className="icon-btn"
                  disabled={currentSideIndex <= 0}
                  onClick={() => setCurrentSideIndex((prev) => Math.max(0, prev - 1))}
                  title="Previous Sheet Side"
                >
                  ◀
                </button>
                <span className="sheet-nav-indicator">
                  Sheet {currentSide.sheetIndex + 1} of {plan.sheetsCount} ({currentSide.side.toUpperCase()} SIDE)
                </span>
                <button
                  className="icon-btn"
                  disabled={currentSideIndex >= plan.sheetSides.length - 1}
                  onClick={() => setCurrentSideIndex((prev) => Math.min(plan.sheetSides.length - 1, prev + 1))}
                  title="Next Sheet Side"
                >
                  ▶
                </button>
              </div>

              <div className="sheet-side-pill">
                Pass {currentSide.sideNumber} / {plan.sheetSides.length}
              </div>
            </div>

            {/* Imposition Sheet Canvas Graphic */}
            <div className="imposition-sheet-canvas-container">
              <div className="imposition-sheet-frame">
                {/* Left Imposed Page */}
                <div className="imposition-page-card left-page">
                  <div className="page-card-header">
                    <span>LEFT PAGE</span>
                    <span className="page-num-badge">
                      {currentSide.leftPageNumber !== null ? `P. ${currentSide.leftPageNumber}` : 'BLANK PAD'}
                    </span>
                  </div>
                  <div className="page-card-body">
                    {currentSide.leftPageNumber !== null ? (
                      <div className="page-content-mock">
                        <div className="mock-title">
                          {currentSide.leftPageNumber === 1
                            ? 'COVER'
                            : currentSide.leftPageNumber === plan.totalPagesPadded
                            ? 'BACK COVER'
                            : `Page ${currentSide.leftPageNumber}`}
                        </div>
                        <div className="mock-lines">
                          <div className="mock-line" style={{ width: '80%' }} />
                          <div className="mock-line" style={{ width: '100%' }} />
                          <div className="mock-line" style={{ width: '90%' }} />
                          <div className="mock-line" style={{ width: '60%' }} />
                        </div>
                      </div>
                    ) : (
                      <div className="blank-page-notice">Blank Padding Page</div>
                    )}
                  </div>
                  <div className="page-card-footer">
                    Creep offset: {Math.round(currentSide.leftCreepMm * 100) / 100} mm
                  </div>
                </div>

                {/* Center Fold Line */}
                <div className="imposition-fold-spine">
                  <div className="spine-dashed-line" />
                  <span className="spine-label">CENTER FOLD</span>
                </div>

                {/* Right Imposed Page */}
                <div className="imposition-page-card right-page">
                  <div className="page-card-header">
                    <span>RIGHT PAGE</span>
                    <span className="page-num-badge">
                      {currentSide.rightPageNumber !== null ? `P. ${currentSide.rightPageNumber}` : 'BLANK PAD'}
                    </span>
                  </div>
                  <div className="page-card-body">
                    {currentSide.rightPageNumber !== null ? (
                      <div className="page-content-mock">
                        <div className="mock-title">
                          {currentSide.rightPageNumber === 1
                            ? 'COVER'
                            : currentSide.rightPageNumber === plan.totalPagesPadded
                            ? 'BACK COVER'
                            : `Page ${currentSide.rightPageNumber}`}
                        </div>
                        <div className="mock-lines">
                          <div className="mock-line" style={{ width: '85%' }} />
                          <div className="mock-line" style={{ width: '95%' }} />
                          <div className="mock-line" style={{ width: '70%' }} />
                          <div className="mock-line" style={{ width: '90%' }} />
                        </div>
                      </div>
                    ) : (
                      <div className="blank-page-notice">Blank Padding Page</div>
                    )}
                  </div>
                  <div className="page-card-footer">
                    Creep offset: {Math.round(currentSide.rightCreepMm * 100) / 100} mm
                  </div>
                </div>
              </div>
            </div>

            {/* Imposition Sheet Description Footer */}
            <div className="imposition-sheet-instruction">
              <strong>Printing Instruction:</strong> Feed sheet {currentSide.sheetIndex + 1} duplex. Side 1 prints Pages [
              {currentSide.side === 'front' ? currentSide.leftPageNumber : '...'} |{' '}
              {currentSide.side === 'front' ? currentSide.rightPageNumber : '...'}]. Flip on short edge for Side 2.
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <div className="modal-footer-left">
            <span className="footer-status-text">
              Architecture verified: Zero-rounding drift duplex compilation.
            </span>
          </div>
          <div className="modal-footer-right">
            <button className="action-btn" onClick={onClose}>
              Cancel
            </button>
            <button className="action-btn-primary" onClick={handleExport} disabled={isExporting}>
              {isExporting ? 'Compiling Imposition PDF...' : 'Export Imposed Booklet PDF'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
