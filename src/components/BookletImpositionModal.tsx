/**
 * Recto Studio — Booklet Imposition Modal
 * Copyright (c) 2022-2026 Abhinav Sidhu. All rights reserved.
 * Licensed under the MIT License.
 */

import { useState } from 'preact/hooks';
import { savePublicationFile } from '../desktop';
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
  const [exportError, setExportError] = useState('');

  const plan: ImpositionPlan = calculateImpositionPlan(state, {
    bindingMode,
    signatureSize,
    paperStockWeightGsm: paperWeightGsm,
    creepMmPerSheet: creepMm,
  });

  const currentSide: ImpositionSheetSide = plan.sheetSides[currentSideIndex] || plan.sheetSides[0];
  const isZine = !!currentSide.panels;
  const canSetCreep = bindingMode === 'saddle-stitch' || bindingMode === 'perfect-bound';
  const safeTitle = (state.settings.title || 'publication').toLowerCase().replace(/[^a-z0-9_-]/g, '-');

  async function saveSheetPlan() {
    setExportError('');
    try {
      const contents = JSON.stringify({ format: 'recto-sheet-plan-v1', ...plan, includeCutMarks }, null, 2) + '\n';
      await savePublicationFile(`${safeTitle}-sheet-plan.json`, new Blob([contents], { type: 'application/json' }), 'application/json');
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Could not save the sheet plan.');
    }
  }

  const handleExport = async () => {
    try {
      setIsExporting(true);
      setExportError('');
      const pdf = await exportImposedBookletPdf(state, {
        bindingMode,
        signatureSize,
        paperStockWeightGsm: paperWeightGsm,
        creepMmPerSheet: creepMm,
        includeCutMarks,
      });

      await savePublicationFile(`${safeTitle}-imposed-booklet-${bindingMode}.pdf`, pdf.blob(), 'application/pdf');
    } catch (err) {
      console.error('Failed to export imposed booklet', err);
      setExportError(err instanceof Error ? err.message : 'Imposition export failed.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog imposition-modal-dialog" role="dialog" aria-modal="true"
        aria-labelledby="imposition-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title" id="imposition-title">Booklet Imposition</h2>
            <div className="modal-subtitle">
              Set printer order, sheet size, and fold guides
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
              <label htmlFor="imposition-binding">Binding Mode</label>
              <select
                id="imposition-binding"
                className="imposition-select"
                value={bindingMode}
                onChange={(e) => {
                  setBindingMode((e.target as HTMLSelectElement).value as ImpositionBindingMode);
                  setCurrentSideIndex(0);
                }}
              >
                <option value="saddle-stitch">Saddle-Stitch (Folded & Stapled Booklet)</option>
                <option value="perfect-bound">Multi-Signature Perfect Bound (Glued Spine)</option>
                <option value="mini-zine-8page">8-Page Mini-Zine (1-Sheet French Fold & Slit)</option>
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

            {canSetCreep && <><div className="imposition-field">
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
                onInput={(e) => setCreepMm(Math.max(0, Math.min(0.5, parseFloat((e.target as HTMLInputElement).value) || 0)))}
              />
              <div className="imposition-field-hint">
                Max calculated creep: {Math.round(plan.maxCreepMm * 100) / 100} mm at innermost sheet
              </div>
            </div></>}

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
                <strong>{plan.sheetsCount} {plan.sheetsCount === 1 ? 'sheet' : 'sheets'} ({plan.sheetSides.length} printed {plan.sheetSides.length === 1 ? 'side' : 'sides'})</strong>
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
            {isZine ? (
              <div className="imposition-zine-grid" role="group" aria-label="Eight-panel mini-zine fold map">
                {currentSide.panels!.map((page, index) => (
                  <div className="imposition-zine-panel" key={index}>
                    <span style={index < 4 ? { transform: 'rotate(180deg)' } : undefined}>{page ? `Page ${page}` : 'Blank'}</span>
                  </div>
                ))}
              </div>
            ) : <div className="imposition-sheet-canvas-container">
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
            </div>}

            {/* Imposition Sheet Description Footer */}
            <div className="imposition-sheet-instruction">
              {isZine ? 'Print single-sided at actual size. Fold on the dashed guides and slit the solid center segment.'
                : 'Print a duplex test sheet at actual size and verify orientation and creep with your printer.'}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <div className="modal-footer-left">
            {exportError && <span className="footer-status-text" role="alert">{exportError}</span>}
          </div>
          <div className="modal-footer-right">
            <button className="action-btn" onClick={saveSheetPlan}>Save Sheet Plan</button>
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
