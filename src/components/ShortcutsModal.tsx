/**
 * Recto Studio — High-Precision Desktop Publishing Engine
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 */

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  keys: string[];
  desc: string;
}

interface ShortcutSection {
  title: string;
  items: ShortcutItem[];
}

const SHORTCUT_SECTIONS: ShortcutSection[] = [
  {
    title: 'Tools & Navigation',
    items: [
      { keys: ['V'], desc: 'Selection Tool' },
      { keys: ['T'], desc: 'Type / Text Tool' },
      { keys: ['M', 'F'], desc: 'Rectangle Frame Tool' },
      { keys: ['P'], desc: 'Pen Tool (Bézier Paths)' },
      { keys: ['Space', 'Drag'], desc: 'Hand Tool (Pan Canvas)' },
      { keys: ['Z'], desc: 'Zoom Tool (Click/Drag)' },
      { keys: ['K'], desc: 'Measure Tool (Distance, Angle & Delta)' },
      { keys: ['W'], desc: 'Toggle Screen Preview Mode' },
      { keys: ['Cmd/Ctrl', ';'], desc: 'Toggle Margin & Column Guides' },
      { keys: ['Cmd/Ctrl', 'Alt', "'"], desc: 'Toggle Baseline Grid' },
      { keys: ['Cmd/Ctrl', 'Alt', 'A'], desc: 'Toggle Reading Order Overlay (A11y)' },
      { keys: ['Cmd/Ctrl', 'Alt', 'S'], desc: 'Toggle Prepress Slug Area' },
    ],
  },
  {
    title: 'Typography & Editorial',
    items: [
      { keys: ['Cmd/Ctrl', 'Alt', 'Y'], desc: 'Story Focus / Typewriter Editor' },
      { keys: ['Cmd/Ctrl', 'Alt', 'C'], desc: 'Fit Frame Height to Content' },
      { keys: ['Cmd/Ctrl', 'B'], desc: 'Text Frame Options (Columns, Insets)' },
      { keys: ['Cmd/Ctrl', 'F'], desc: 'Find & Change / GREP Engine' },
      { keys: ['Cmd/Ctrl', '/'], desc: 'Quick Apply Command Palette' },
      { keys: ['Click', '[+]'], desc: 'Thread Overflow to Next Frame' },
      { keys: ['Double-Click'], desc: 'Direct Inline Text Editor' },
      { keys: ['Cmd/Ctrl', 'Alt', 'L'], desc: 'Toggle Editorial Content Lock' },
    ],
  },
  {
    title: 'Arrange & Object Geometry',
    items: [
      { keys: ['Cmd/Ctrl', 'L'], desc: 'Lock / Unlock Element' },
      { keys: ['Cmd/Ctrl', ']'], desc: 'Bring Forward' },
      { keys: ['Cmd/Ctrl', '['], desc: 'Send Backward' },
      { keys: ['Arrows'], desc: 'Nudge 1mm (Shift = 10mm)' },
      { keys: ['Backspace'], desc: 'Delete Selected Element(s)' },
      { keys: ['Shift', 'Click'], desc: 'Multi-Element Selection' },
    ],
  },
  {
    title: 'Document & Output',
    items: [
      { keys: ['Cmd/Ctrl', 'Alt', 'P'], desc: 'Document Setup (Trim, Bleed, Margins)' },
      { keys: ['Cmd/Ctrl', 'K'], desc: 'Document Preferences & Setup Tab' },
      { keys: ['Cmd/Ctrl', 'Z'], desc: 'Undo' },
      { keys: ['Cmd/Ctrl', 'Shift', 'Z'], desc: 'Redo' },
      { keys: ['Cmd/Ctrl', 'Shift', 'I'], desc: 'Booklet Imposition Studio' },
      { keys: ['Cmd/Ctrl', 'Shift', 'B'], desc: 'Book Cover & Spine Calculator' },
      { keys: ['?'], desc: 'Toggle Keyboard Shortcuts' },
      { keys: ['Esc'], desc: 'Close Active Modal / Deselect' },
    ],
  },
];

export function ShortcutsModal({ isOpen, onClose }: ShortcutsModalProps) {
  if (!isOpen) return null;

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
          width: '740px',
          maxWidth: '94vw',
          maxHeight: '85vh',
          backgroundColor: '#18181c',
          borderRadius: '8px',
          border: '1px solid #38383e',
          boxShadow: '0 20px 48px rgba(0, 0, 0, 0.85)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div className="modal-header" style={{ padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #2d2d34' }}>
          <div>
            <h3 className="modal-title" style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#ffffff', letterSpacing: '0.4px' }}>
              KEYBOARD SHORTCUTS MATRIX
            </h3>
            <p className="modal-subtitle" style={{ margin: '3px 0 0', fontSize: '11px', color: '#8e8e93' }}>
              Professional desktop publishing hotkeys for high-speed editorial layout
            </p>
          </div>
          <button
            className="modal-close-btn"
            onClick={onClose}
            title="Close (Esc)"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#8e8e93',
              fontSize: '16px',
              cursor: 'pointer',
              padding: '4px 8px',
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        <div
          style={{
            padding: '20px',
            overflowY: 'auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '20px',
          }}
        >
          {SHORTCUT_SECTIONS.map((section) => (
            <div
              key={section.title}
              style={{
                backgroundColor: '#1f1f24',
                borderRadius: '6px',
                border: '1px solid #2d2d34',
                padding: '12px 16px',
              }}
            >
              <h4
                style={{
                  margin: '0 0 10px 0',
                  fontSize: '11px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: '#e4e4e7',
                  letterSpacing: '0.5px',
                  borderBottom: '1px solid #2d2d34',
                  paddingBottom: '6px',
                }}
              >
                {section.title}
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {section.items.map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: '12px',
                    }}
                  >
                    <span style={{ color: '#a1a1aa' }}>{item.desc}</span>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {item.keys.map((k, kIdx) => (
                        <kbd
                          key={kIdx}
                          style={{
                            backgroundColor: '#27272a',
                            border: '1px solid #3f3f46',
                            borderRadius: '3px',
                            padding: '2px 6px',
                            fontSize: '10px',
                            fontFamily: 'ui-monospace, monospace',
                            color: '#ffffff',
                            fontWeight: 600,
                            boxShadow: '0 1px 2px rgba(0, 0, 0, 0.4)',
                          }}
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            padding: '10px 20px',
            backgroundColor: '#141418',
            borderTop: '1px solid #2d2d34',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '11px',
            color: '#71717a',
          }}
        >
          <span>Tip: Press <kbd style={{ padding: '1px 4px', background: '#27272a', border: '1px solid #3f3f46', borderRadius: '3px', color: '#fff' }}>?</kbd> anywhere to open or close this matrix</span>
          <button
            onClick={onClose}
            style={{
              padding: '4px 14px',
              backgroundColor: '#27272a',
              border: '1px solid #3f3f46',
              borderRadius: '4px',
              color: '#ffffff',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: 500,
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
