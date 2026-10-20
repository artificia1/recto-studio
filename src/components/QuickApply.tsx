/**
 * Recto Studio — High-Precision Desktop Publishing Engine
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 */

import { useState, useRef, useEffect } from 'preact/hooks';
import { ProjectState } from '../types';
import { stateManager } from '../state';

interface QuickApplyProps {
  isOpen: boolean;
  onClose: () => void;
  state: ProjectState;
  onOpenFindChange?: () => void;
  onOpenImposition?: () => void;
  onOpenCoverSpine?: () => void;
}

interface QuickApplyItem {
  id: string;
  kind: 'style-para' | 'style-char' | 'cmd';
  title: string;
  subtitle?: string;
  shortcut?: string;
  action: () => void;
}

export function QuickApply({
  isOpen,
  onClose,
  state,
  onOpenFindChange,
  onOpenImposition,
  onOpenCoverSpine,
}: QuickApplyProps) {
  if (!isOpen) return null;

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Build searchable items catalogue
  const allItems: QuickApplyItem[] = [];

  // 1. Paragraph Styles
  for (const style of state.paragraphStyles || []) {
    allItems.push({
      id: `p-${style.id}`,
      kind: 'style-para',
      title: style.name,
      subtitle: `${style.fontFamily}, ${style.fontSizePt}pt`,
      action: () => {
        if (state.selectedElementId) {
          stateManager.applyParagraphStyle(state.selectedElementId, style.id);
        }
      },
    });
  }

  // 3. Publishing Commands
  allItems.push(
    {
      id: 'cmd-new-blank-a4',
      kind: 'cmd',
      title: 'New Blank Document (A4 Editorial)',
      subtitle: 'Create clean 0-element publication spread',
      shortcut: 'Ctrl+Alt+N',
      action: () => {
        if (confirm('Create a new blank document? All unsaved modifications in current session will be cleared.')) {
          stateManager.createBlankProject('A4', 'Untitled Publication', true);
        }
      },
    },
    {
      id: 'cmd-new-blank-novel',
      kind: 'cmd',
      title: 'New Blank Novel / Book (6 × 9 in)',
      subtitle: 'Create clean 0-element trade book spread',
      action: () => {
        if (confirm('Create a new blank document? All unsaved modifications in current session will be cleared.')) {
          stateManager.createBlankProject('Book-Trade-6x9', 'Untitled Novel', true);
        }
      },
    },
    {
      id: 'cmd-new-blank-letter',
      kind: 'cmd',
      title: 'New Blank Document (US Letter)',
      subtitle: 'Create clean 0-element standard letter spread',
      action: () => {
        if (confirm('Create a new blank document? All unsaved modifications in current session will be cleared.')) {
          stateManager.createBlankProject('US-Letter', 'Untitled Publication', true);
        }
      },
    },
    {
      id: 'cmd-new-blank-digest',
      kind: 'cmd',
      title: 'New Blank Digest Book (5.5 × 8.5 in)',
      subtitle: 'Create clean 0-element digest journal spread',
      action: () => {
        if (confirm('Create a new blank document? All unsaved modifications in current session will be cleared.')) {
          stateManager.createBlankProject('Digest-5.5x8.5', 'Untitled Digest', true);
        }
      },
    },
    {
      id: 'cmd-fit-prop',
      kind: 'cmd',
      title: 'Fit Content Proportionally',
      subtitle: 'Image / Graphic Frame',
      shortcut: 'Ctrl+Alt+Shift+C',
      action: () => stateManager.applyImageFitMode('fill'),
    },
    {
      id: 'cmd-fit-frame',
      kind: 'cmd',
      title: 'Fit Frame to Content',
      subtitle: 'Image / Graphic Frame',
      shortcut: 'Ctrl+Alt+C',
      action: () => stateManager.applyImageFitMode('frameToContent'),
    },
    {
      id: 'cmd-center-content',
      kind: 'cmd',
      title: 'Center Content in Frame',
      subtitle: 'Image / Graphic Frame',
      shortcut: 'Ctrl+Shift+E',
      action: () => stateManager.applyImageFitMode('center'),
    },
    {
      id: 'cmd-find-change',
      kind: 'cmd',
      title: 'Find / Change (GREP)',
      subtitle: 'Search and replace text or regex',
      shortcut: 'Ctrl+F',
      action: () => {
        if (onOpenFindChange) onOpenFindChange();
      },
    },
    {
      id: 'cmd-baseline-grid',
      kind: 'cmd',
      title: 'Toggle Baseline Grid',
      subtitle: 'Align body baselines across columns',
      action: () => stateManager.toggleBaselineGrid(),
    },
    {
      id: 'cmd-overprint-black',
      kind: 'cmd',
      title: 'Toggle PostScript Overprint Black RIP (/OP true)',
      subtitle: 'Commercial Prepress Offset Printing',
      action: () => stateManager.toggleOverprintBlack(),
    },
    {
      id: 'cmd-facing-pages',
      kind: 'cmd',
      title: 'Toggle Facing Pages (Book/Magazine Spread)',
      subtitle: 'Document Settings',
      action: () => stateManager.toggleFacingPages(),
    },
    {
      id: 'cmd-align-left',
      kind: 'cmd',
      title: 'Align Left',
      subtitle: 'Publishing Alignment',
      action: () => stateManager.alignElements('left'),
    },
    {
      id: 'cmd-align-center',
      kind: 'cmd',
      title: 'Align Horizontal Center',
      subtitle: 'Publishing Alignment',
      action: () => stateManager.alignElements('center'),
    },
    {
      id: 'cmd-align-right',
      kind: 'cmd',
      title: 'Align Right',
      subtitle: 'Publishing Alignment',
      action: () => stateManager.alignElements('right'),
    },
    {
      id: 'cmd-align-top',
      kind: 'cmd',
      title: 'Align Top',
      subtitle: 'Publishing Alignment',
      action: () => stateManager.alignElements('top'),
    },
    {
      id: 'cmd-align-middle',
      kind: 'cmd',
      title: 'Align Vertical Center',
      subtitle: 'Publishing Alignment',
      action: () => stateManager.alignElements('middle'),
    },
    {
      id: 'cmd-align-bottom',
      kind: 'cmd',
      title: 'Align Bottom',
      subtitle: 'Publishing Alignment',
      action: () => stateManager.alignElements('bottom'),
    },
    {
      id: 'cmd-dist-h',
      kind: 'cmd',
      title: 'Distribute Spacing Horizontally',
      subtitle: 'Equalize space between elements',
      action: () => stateManager.distributeElements('horizontal'),
    },
    {
      id: 'cmd-dist-v',
      kind: 'cmd',
      title: 'Distribute Spacing Vertically',
      subtitle: 'Equalize space between elements',
      action: () => stateManager.distributeElements('vertical'),
    },
    {
      id: 'cmd-add-spread',
      kind: 'cmd',
      title: 'Add New Spread',
      subtitle: 'Insert facing pages spread',
      action: () => stateManager.addSpread(),
    },
    {
      id: 'cmd-duplicate-spread',
      kind: 'cmd',
      title: 'Duplicate Current Spread',
      subtitle: 'Clone active layout',
      action: () => stateManager.duplicateSpread(state.activeSpreadIndex),
    },
    {
      id: 'cmd-lock',
      kind: 'cmd',
      title: 'Lock / Unlock Selection',
      subtitle: 'Protect frames against movement',
      shortcut: 'Ctrl+L',
      action: () => stateManager.toggleLock(),
    },
    {
      id: 'cmd-editorial-lock',
      kind: 'cmd',
      title: 'Toggle Editorial Frame Lock',
      subtitle: 'Copywriters can edit text, geometry and position locked',
      shortcut: 'Ctrl+Alt+L',
      action: () => stateManager.toggleEditorialLock(),
    },
    {
      id: 'cmd-delete',
      kind: 'cmd',
      title: 'Delete Selected Elements',
      subtitle: 'Remove frames from spread',
      shortcut: 'Delete',
      action: () => stateManager.deleteSelectedElements(),
    },
    {
      id: 'cmd-zoom-fit',
      kind: 'cmd',
      title: 'Zoom to Fit Page',
      subtitle: 'Fit spread in viewport',
      action: () => {
        stateManager.setZoom(0.85);
        stateManager.setPan(0, 0);
      },
    },
    {
      id: 'cmd-zoom-100',
      kind: 'cmd',
      title: 'Zoom to 100% (Actual Size)',
      subtitle: '1:1 Print scale preview',
      action: () => stateManager.setZoom(1.0),
    },
    {
      id: 'cmd-zoom-200',
      kind: 'cmd',
      title: 'Zoom to 200% (Detail View)',
      subtitle: 'High precision typography inspection',
      action: () => stateManager.setZoom(2.0),
    },
    {
      id: 'cmd-booklet-imposition',
      kind: 'cmd',
      title: 'Booklet Imposition Studio',
      subtitle: 'Saddle-stitch, signatures, creep shingling & 2-up proofing',
      shortcut: 'Ctrl+Shift+I',
      action: () => {
        if (onOpenImposition) onOpenImposition();
      },
    },
    {
      id: 'cmd-cover-spine-calculator',
      kind: 'cmd',
      title: 'Book Cover & Spine Width Calculator',
      subtitle: 'Caliper/PPI spine thickness, wrap jacket & 3D preview',
      shortcut: 'Ctrl+Shift+B',
      action: () => {
        if (onOpenCoverSpine) onOpenCoverSpine();
      },
    }
  );

  // Filter items
  const cleanQ = query.trim().toLowerCase();
  const filtered = cleanQ
    ? allItems.filter(
        (it) =>
          it.title.toLowerCase().includes(cleanQ) ||
          (it.subtitle && it.subtitle.toLowerCase().includes(cleanQ))
      )
    : allItems;

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filtered.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % Math.max(1, filtered.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        filtered[selectedIndex].action();
        onClose();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const executeItem = (item: QuickApplyItem) => {
    item.action();
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
        background: 'rgba(0, 0, 0, 0.45)',
        zIndex: 1300,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
        backdropFilter: 'blur(3px)',
      }}
    >
      <div
        className="quick-apply-box"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#1c1c20',
          border: '1px solid #383842',
          borderRadius: '8px',
          width: '500px',
          maxWidth: '92vw',
          boxShadow: '0 16px 40px rgba(0,0,0,0.7)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        {/* Search Input Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '12px 16px',
            borderBottom: '1px solid #2d2d35',
            background: '#222228',
            gap: '10px',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0d99ff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onInput={(e) => {
              setQuery((e.target as HTMLInputElement).value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Quick Apply... (type a style or command, e.g. 'h1', 'fit', 'grid')"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#fff',
              fontSize: '13px',
              fontFamily: 'inherit',
            }}
          />
          <span
            style={{
              fontSize: '10px',
              color: '#777',
              border: '1px solid #3a3a44',
              borderRadius: '3px',
              padding: '1px 5px',
            }}
          >
            ESC
          </span>
        </div>

        {/* Results List */}
        <div
          ref={listRef}
          style={{
            maxHeight: '340px',
            overflowY: 'auto',
            padding: '6px',
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: '#777', fontSize: '12px' }}>
              No styles or commands matching "{query}"
            </div>
          ) : (
            filtered.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              const badgeBg =
                item.kind === 'style-para'
                  ? 'rgba(13, 153, 255, 0.18)'
                  : item.kind === 'style-char'
                  ? 'rgba(16, 185, 129, 0.18)'
                  : 'rgba(230, 0, 126, 0.18)';
              const badgeColor =
                item.kind === 'style-para'
                  ? '#38bdf8'
                  : item.kind === 'style-char'
                  ? '#34d399'
                  : '#ff40a1';
              const badgeLabel =
                item.kind === 'style-para' ? 'P' : item.kind === 'style-char' ? 'C' : 'CMD';

              return (
                <div
                  key={item.id}
                  onClick={() => executeItem(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: '5px',
                    background: isSelected ? 'rgba(13, 153, 255, 0.14)' : 'transparent',
                    border: isSelected ? '1px solid rgba(13, 153, 255, 0.35)' : '1px solid transparent',
                    cursor: 'pointer',
                    transition: 'all 0.1s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span
                      style={{
                        fontSize: '9px',
                        fontWeight: 700,
                        padding: '2px 5px',
                        borderRadius: '3px',
                        background: badgeBg,
                        color: badgeColor,
                        minWidth: '28px',
                        textAlign: 'center',
                      }}
                    >
                      {badgeLabel}
                    </span>
                    <div>
                      <div style={{ color: isSelected ? '#fff' : '#e2e2e8', fontWeight: 500, fontSize: '12px' }}>
                        {item.title}
                      </div>
                      {item.subtitle && (
                        <div style={{ color: '#888894', fontSize: '10px', marginTop: '1px' }}>
                          {item.subtitle}
                        </div>
                      )}
                    </div>
                  </div>

                  {item.shortcut && (
                    <span
                      style={{
                        fontSize: '10px',
                        color: '#888',
                        background: '#151518',
                        border: '1px solid #33333c',
                        borderRadius: '3px',
                        padding: '2px 5px',
                      }}
                    >
                      {item.shortcut}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer Hint */}
        <div
          style={{
            padding: '7px 14px',
            borderTop: '1px solid #282830',
            background: '#17171a',
            fontSize: '10px',
            color: '#666',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>↑ ↓ Navigate</span>
          <span>↵ Apply / Run</span>
        </div>
      </div>
    </div>
  );
}
