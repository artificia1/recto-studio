/**
 * Recto Studio — Pure Vector QR Code Generator Modal
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 */

import { useState } from 'preact/hooks';
import { stateManager } from '../state';
import { generateQrSvg } from '../engine/qrEngine';

interface QrCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function QrCodeModal({ isOpen, onClose }: QrCodeModalProps) {
  const [qrType, setQrType] = useState<'url' | 'text' | 'email' | 'wifi'>('url');
  const [content, setContent] = useState('https://recto.studio');
  const [sizeMm, setSizeMm] = useState(30);
  if (!isOpen) return null;

  const previewSvg = generateQrSvg(content || 'https://recto.studio', sizeMm);

  const handleInsert = () => {
    stateManager.insertQrCode(content || 'https://recto.studio', { sizeMm });
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
              INSERT VECTOR QR CODE
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: '10.5px', color: '#8e8e93' }}>
              ISO/IEC 18004 high-precision vector QR code for print and digital publishing
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#8e8e93',
              fontSize: '18px',
              cursor: 'pointer',
              padding: '0 4px',
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: '20px', display: 'flex', gap: '20px' }}>
          {/* Left: Inputs */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#d1d1d6', marginBottom: '4px' }}>
                Type:
              </label>
              <div style={{ display: 'flex', gap: '4px' }}>
                {(['url', 'text', 'email', 'wifi'] as const).map(t => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setQrType(t);
                      if (t === 'url' && !content.startsWith('http')) setContent('https://recto.studio');
                      else if (t === 'email') setContent('mailto:editorial@recto.studio');
                      else if (t === 'wifi') setContent('WIFI:T:WPA;S:StudioNetwork;P:SuperSecret;;');
                    }}
                    style={{
                      flex: 1,
                      padding: '4px 6px',
                      fontSize: '10px',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      backgroundColor: qrType === t ? '#0d99ff' : '#28282f',
                      color: qrType === t ? '#ffffff' : '#a0a0a8',
                      border: '1px solid',
                      borderColor: qrType === t ? '#0d99ff' : '#3c3c44',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#d1d1d6', marginBottom: '4px' }}>
                Payload / Content:
              </label>
              <input
                type="text"
                value={content}
                onInput={(e) => setContent((e.target as HTMLInputElement).value)}
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  backgroundColor: '#232328',
                  border: '1px solid #3c3c44',
                  borderRadius: '4px',
                  color: '#ffffff',
                  fontSize: '11px',
                  fontFamily: 'monospace',
                  outline: 'none',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#d1d1d6', marginBottom: '4px' }}>
                Print Size: {sizeMm} mm
              </label>
              <input
                type="range"
                min={15}
                max={80}
                step={5}
                value={sizeMm}
                onInput={(e) => setSizeMm(parseInt((e.target as HTMLInputElement).value, 10) || 30)}
                style={{ width: '100%' }}
              />
            </div>
          </div>

          {/* Right: Preview */}
          <div
            style={{
              width: '140px',
              height: '140px',
              backgroundColor: '#ffffff',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '8px',
              border: '1px solid #444',
            }}
            dangerouslySetInnerHTML={{ __html: previewSvg }}
          />
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid #2d2d34', display: 'flex', justifyContent: 'flex-end', gap: '8px', backgroundColor: '#131316' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '6px 14px',
              fontSize: '11px',
              backgroundColor: 'transparent',
              border: '1px solid #3c3c44',
              color: '#d1d1d6',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleInsert}
            style={{
              padding: '6px 16px',
              fontSize: '11px',
              fontWeight: 600,
              backgroundColor: '#0d99ff',
              border: 'none',
              color: '#ffffff',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Insert QR Code
          </button>
        </div>
      </div>
    </div>
  );
}
