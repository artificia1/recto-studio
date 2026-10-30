/**
 * Recto Studio — Pure Vector Barcode & ISBN Generator Modal
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 */

import { useState } from 'preact/hooks';
import { stateManager } from '../state';
import { generateEan13Svg } from '../engine/barcodeEngine';

interface BarcodeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BarcodeModal({ isOpen, onClose }: BarcodeModalProps) {
  const [rawDigits, setRawDigits] = useState('9780132350884');
  const [showText, setShowText] = useState(true);
  if (!isOpen) return null;

  const previewSvg = generateEan13Svg(rawDigits, { showText });

  const handleInsert = () => {
    stateManager.insertBarcode(rawDigits);
    onClose();
  };

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(3px)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        className="modal-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '460px',
          backgroundColor: '#18181c',
          borderRadius: '8px',
          border: '1px solid #38383e',
          boxShadow: '0 20px 48px rgba(0, 0, 0, 0.85)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #2d2d34', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: '#ffffff' }}>
              INSERT ISBN-13 / EAN-13 BARCODE
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: '10.5px', color: '#8e8e93' }}>
              Prepress vector barcode with automatic EAN-13 modulus-10 check digit
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#8e8e93', fontSize: '16px', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '11px', color: '#a0a0a5', marginBottom: '6px' }}>
              ISBN-13 or EAN-13 Digits (12 or 13 numbers):
            </label>
            <input
              type="text"
              value={rawDigits}
              onInput={(e) => setRawDigits((e.target as HTMLInputElement).value)}
              placeholder="e.g. 9780132350884"
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: '4px',
                border: '1px solid #38383e',
                backgroundColor: '#121214',
                color: '#ffffff',
                fontFamily: 'monospace',
                fontSize: '13px',
              }}
            />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: '#e0e0e0', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showText}
              onChange={(e) => setShowText((e.target as HTMLInputElement).checked)}
            />
            Show human-readable ISBN text under bars
          </label>

          {/* Live Preview */}
          <div
            style={{
              padding: '14px',
              backgroundColor: '#ffffff',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '110px',
            }}
            dangerouslySetInnerHTML={{ __html: previewSvg }}
          />

          <button
            onClick={handleInsert}
            className="action-btn-primary"
            style={{
              width: '100%',
              padding: '8px',
              marginTop: '4px',
              backgroundColor: '#0d99ff',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Insert Barcode to Spread
          </button>
        </div>
      </div>
    </div>
  );
}
