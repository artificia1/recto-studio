import type { PagePreset, ProjectState } from '../types';
import { isDesktop } from '../desktop';
import { stateManager } from '../state';

interface FileMenuProps {
  state: ProjectState;
  selectedTextId?: string;
  onClose(): void;
  onSave(saveAs?: boolean): void;
  onRecovery(): void;
  handleCreateBlank(preset: PagePreset, facing: boolean): void;
  handleOpenClick(): void;
  handleIdmlClick(): void;
  handleInddClick(): void;
  handlePlaceClick(): void;
  onMerge(): void;
  onScribus(): void;
  onOpenDocumentSetup?(): void;
  onOpenQr?(): void;
  onOpenEquation?(): void;
  onOpenBarcode?(): void;
  onOpenStoryEditor?(): void;
  onOpenScripts?(): void;
  onOpenShortcuts?(): void;
  handleOpenCoverSpine(): void;
  handleOpenImposition(): void;
}

export default function FileMenu({
  state, selectedTextId, onClose, onSave, onRecovery, handleCreateBlank, handleOpenClick,
  handleIdmlClick, handleInddClick, handlePlaceClick, onMerge, onScribus, onOpenDocumentSetup,
  onOpenQr, onOpenEquation, onOpenBarcode, onOpenStoryEditor, onOpenScripts, onOpenShortcuts,
  handleOpenCoverSpine, handleOpenImposition,
}: FileMenuProps) {
  return (
    <div className="top-dropdown-menu file-dropdown-menu">
      <button
        className="top-dropdown-item"
        onClick={() => {
          onClose();
          handleCreateBlank(state.settings.preset || 'A4', state.settings.facingPages !== false);
        }}
        title="Create a brand new blank document (Ctrl+N)"
      >
        <span>New Blank Document...</span>
        <span className="dropdown-item-shortcut">Ctrl+N</span>
      </button>
      <button
        className="top-dropdown-item"
        onClick={() => {
          onClose();
          handleOpenClick();
        }}
        title="Load .recto, .idml, or .json project file (Ctrl+O)"
      >
        <span>Open Project...</span>
        <span className="dropdown-item-shortcut">Ctrl+O</span>
      </button>
      <button
        className="top-dropdown-item"
        onClick={() => {
          onClose();
          onSave();
        }}
        title="Save current project to .recto package (Ctrl+S)"
      >
        <span>Save Project (.recto)</span>
        <span className="dropdown-item-shortcut">Ctrl+S</span>
      </button>
      {isDesktop() && <>
        <button className="top-dropdown-item" onClick={() => { onClose(); onSave(true); }}>
          <span>Save Project As…</span>
          <span className="dropdown-item-shortcut">Ctrl+Shift+S</span>
        </button>
        <button className="top-dropdown-item" onClick={() => { onClose(); onRecovery(); }}>
          <span>Recover Unsaved Projects…</span>
        </button>
      </>}
      <button
        className="top-dropdown-item"
        onClick={() => {
          onClose();
          stateManager.addSpread();
        }}
        title="Insert New Page Spread"
      >
        <span>+ Add Page Spread</span>
      </button>
      <button
        className="top-dropdown-item"
        onClick={() => {
          onClose();
          onOpenDocumentSetup?.();
        }}
        title="Adjust trim dimensions, facing pages, margins, bleed, and baseline grid (Alt+Ctrl+P)"
      >
        <span>Document Setup / Preferences...</span>
        <span className="dropdown-item-shortcut">Alt+Ctrl+P</span>
      </button>

      <button className="top-dropdown-item" onClick={() => {
        onClose();
        try {
          const count = stateManager.paginateStory(state.selectedElementId || '');
          alert(count ? `Added ${count} linked page${count === 1 ? '' : 's'}. You can undo this change.` : 'The story already fits its frames.');
        } catch (error) {
          alert(error instanceof Error ? error.message : String(error));
        }
      }}><span>Auto-paginate selected story</span></button>
      <div className="dropdown-menu-divider" />
      <button className="top-dropdown-item" onClick={() => { onClose(); onScribus(); }}>
        <div className="dropdown-item-title">Import Scribus Document (.sla)…</div>
      </button>

      <button
        className="top-dropdown-item"
        onClick={() => {
          onClose();
          handleInddClick();
        }}
        title="Convert INDD through IDML or recover content fragments"
      >
        <div>
          <div className="dropdown-item-title">Import InDesign Document (.indd)...</div>
          <div className="dropdown-item-sub">IDML conversion guide or limited content recovery</div>
        </div>
      </button>
      <button
        className="top-dropdown-item"
        onClick={() => {
          onClose();
          handleIdmlClick();
        }}
        title="Open Adobe InDesign XML Package (.idml)"
      >
        <div>
          <div className="dropdown-item-title">Import InDesign Package (.idml)...</div>
          <div className="dropdown-item-sub">Complete vector frames, text styles, swatches & geometry</div>
        </div>
      </button>
      <button
        className="top-dropdown-item"
        onClick={() => {
          onClose();
          handlePlaceClick();
        }}
        title="Place markdown, text, or Word document into selected frame (Ctrl+D)"
      >
        <span>Place Manuscript Text...</span>
        <span className="dropdown-item-shortcut">Ctrl+D</span>
      </button>
      <button
        className="top-dropdown-item"
        onClick={() => {
          onClose();
          onMerge();
        }}
        title="Batch populate records via CSV dataset"
      >
        <span>Data Merge (CSV / JSON)...</span>
      </button>
      {selectedTextId && (
        <button
          className="top-dropdown-item"
          onClick={() => {
            onClose();
            const note = prompt('Enter Footnote Reference Text:', 'Citation or footnote note');
            if (note !== null) {
              stateManager.insertFootnote(selectedTextId, note);
            }
          }}
          title="Insert Footnote into selected text frame"
        >
          <span>Insert Footnote...</span>
        </button>
      )}
      <button
        className="top-dropdown-item"
        onClick={() => {
          onClose();
          const activePage = stateManager.getActiveSpread().pages[0];
          if (activePage) {
            stateManager.generateTableOfContents(activePage.id, '.');
          }
        }}
        title="Scan document headings and generate automated Table of Contents with dot leaders"
      >
        <span>Generate Table of Contents...</span>
      </button>

      <div className="dropdown-menu-divider" />

      <button
        className="top-dropdown-item"
        onClick={() => {
          onClose();
          onOpenQr?.();
        }}
        title="Generate native vector ISO/IEC 18004 QR code"
      >
        <span>Insert Vector QR Code...</span>
      </button>
      <button className="top-dropdown-item" onClick={() => { onClose(); onOpenEquation?.(); }}
        title="Insert an editable LaTeX equation">
        <span>Insert Equation (LaTeX)…</span>
      </button>
      <button
        className="top-dropdown-item"
        onClick={() => {
          onClose();
          onOpenBarcode?.();
        }}
        title="Generate vector ISBN-13 / EAN-13 bookland barcode"
      >
        <span>Insert ISBN / Barcode...</span>
      </button>

      <div className="dropdown-menu-divider" />

      <button
        className="top-dropdown-item"
        onClick={() => {
          onClose();
          onOpenStoryEditor?.();
        }}
        title="Open distraction-free Story Focus typewriter editor (Ctrl+Alt+Y)"
      >
        <span>Story Focus Editor...</span>
        <span className="dropdown-item-shortcut">Ctrl+Y</span>
      </button>
      <button
        className="top-dropdown-item"
        onClick={() => {
          onClose();
          onOpenScripts?.();
        }}
        title="InDesign-style publishing automation & JavaScript scripts (Alt+F11)"
      >
        <span>Scripts & Automation...</span>
        <span className="dropdown-item-shortcut">Alt+F11</span>
      </button>
      <button
        className="top-dropdown-item"
        onClick={() => {
          onClose();
          stateManager.insertIndexStory();
        }}
        title="Compiles alphabetical multi-level A-Z index"
      >
        <span>Generate Book Index Spread</span>
      </button>
      <button
        className="top-dropdown-item"
        onClick={() => {
          onClose();
          handleOpenCoverSpine();
        }}
        title="Mathematical spine caliper, 3D jacket wrap & barcode zone"
      >
        <span>Book Cover & Spine Calculator...</span>
      </button>
      <button
        className="top-dropdown-item"
        onClick={() => {
          onClose();
          handleOpenImposition();
        }}
        title="Duplex booklet imposition for saddle-stitch and multi-signature print"
      >
        <span>Booklet Imposition Studio...</span>
      </button>

      <div className="dropdown-menu-divider" />

      <button
        className="top-dropdown-item"
        onClick={() => {
          onClose();
          stateManager.toggleReadingOrder();
        }}
        title="Toggle visual reading order inspection badges"
      >
        <span>Reading Order Overlay</span>
        <span className="dropdown-item-shortcut">{state.showReadingOrder ? 'Hide' : 'Show'}</span>
      </button>
      <button
        className="top-dropdown-item"
        onClick={() => {
          onClose();
          stateManager.toggleSlugBanner();
        }}
        title="Toggle prepress slug information area & CMYK color bars"
      >
        <span>Prepress Slug Area & Bars</span>
        <span className="dropdown-item-shortcut">{state.showSlugBanner ? 'Hide' : 'Show'}</span>
      </button>
      <button
        className="top-dropdown-item"
        onClick={() => {
          onClose();
          stateManager.toggleQuickActionsToolbar();
        }}
        title="Toggle floating quick actions toolbar for selected elements"
      >
        <span>Touch Quick Actions Bar</span>
        <span className="dropdown-item-shortcut">{state.showQuickActionsToolbar ? 'Hide' : 'Show'}</span>
      </button>

      <div className="dropdown-menu-divider" />

      <button
        className="top-dropdown-item"
        onClick={() => {
          onClose();
          onOpenShortcuts?.();
        }}
        title="View complete keyboard shortcut matrix (Press ? or Ctrl+/)"
      >
        <span>Keyboard Shortcuts Matrix...</span>
        <span className="dropdown-item-shortcut">?</span>
      </button>
    </div>
  );
}
