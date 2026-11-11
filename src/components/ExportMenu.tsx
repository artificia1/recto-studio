import { Fragment } from 'preact';
import type { PublicationDownload } from '../export/publicationDownloads';

export type ExportAction = PublicationDownload | 'booklet' | 'cover';

const groups: { action: ExportAction; name: string; description?: string; title?: string }[][] = [
  [
    { action: 'proof', name: 'Standard PDF (Clean / Proof)', description: 'Trim-sized pages for digital sharing and proofing' },
    { action: 'press', name: 'Print PDF (Bleed & Marks)', description: 'CMYK, bleed, crop marks, color bars, and registration' },
    { action: 'epub', name: 'Export EPUB 3', description: 'Reflowable ebook with adjustable text' },
    { action: 'fixed', name: 'Export Fixed-Layout EPUB', description: 'Page-sized XHTML with selectable text' },
    { action: 'flipbook', name: 'Export Web Flipbook', description: 'Single-file HTML5 with page-flip animations' },
    { action: 'image', name: 'Export Spread as Image (PNG)...', description: 'High-resolution raster proof',
      title: 'Export current spread as high-resolution PNG image' },
  ],
  [
    { action: 'package', name: 'Package Document for Print...', description: 'Bundle project, PDF, assets, and instructions' },
    { action: 'idml', name: 'Adobe InDesign Package (.idml)', description: 'Two-way exchange package for agency handoff' },
    { action: 'kit', name: 'InDesign Validation Kit (.zip)', description: 'IDML and a native round-trip check script' },
  ],
  [
    { action: 'booklet', name: 'Export Imposed Booklet PDF...', description: 'Duplex signatures with marks and creep compensation',
      title: 'Export imposed duplex printer spreads' },
    { action: 'cover', name: 'Export Full Wrap Cover PDF...', description: 'Wrap with calculated spine, fold guides, and bleed',
      title: 'Export print-ready wrap jacket cover' },
  ],
];

export default function ExportMenu({ onExport, onClose }: { onExport: (action: ExportAction) => void; onClose: () => void }) {
  return <div className="top-dropdown-menu export-dropdown-menu">
    {groups.map((group, index) => <Fragment key={group[0].action}>
      {index > 0 && <div className="dropdown-divider"/>}
      {group.map(item => <button key={item.action} aria-label={item.name} className="top-dropdown-item" title={item.title} onClick={() => {
        onClose();
        onExport(item.action);
      }}>
        <div><div className="dropdown-item-title">{item.name}</div>
          {item.description && <div className="dropdown-item-sub">{item.description}</div>}</div>
      </button>)}
    </Fragment>)}
  </div>;
}
