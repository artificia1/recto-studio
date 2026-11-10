import type { ProjectState } from '../../types';
import { bookCoverDimensions, DELIVERY_BINDINGS, type BookDeliveryRecipe, type DeliveryBinding } from '../../engine/bookDelivery';
import { PAPER_STOCK_PRESETS, type PaperStockPreset } from '../../engine/spineCalculator';
import { PDF_PRESETS, type PdfPreset } from '../../export/presets';

interface Props {
  recipe: BookDeliveryRecipe;
  settings: ProjectState['settings'];
  pageCount: number;
  disabled: boolean;
  onChange: (recipe: BookDeliveryRecipe) => void;
  onCover: (file: File) => void;
  onExport: () => void;
}

export default function BookDeliveryPanel({ recipe, settings, pageCount, disabled, onChange, onCover, onExport }: Props) {
  const dimensions = bookCoverDimensions(settings, pageCount, recipe);
  const approved = recipe.approvedDimensions === dimensions.signature && dimensions.matches;
  return <details>
    <summary>Book delivery package</summary>
    <p>Export the interior, a reviewed cover, a reflowable EPUB, and a delivery report together.</p>
    <label>Interior and cover PDF preset<select value={recipe.preset} disabled={disabled} onChange={event =>
      onChange({ ...recipe, preset: event.currentTarget.value as PdfPreset })}>
      {Object.entries(PDF_PRESETS).map(([key, preset]) => <option value={key} key={key}>{preset.label}</option>)}
    </select></label>
    <label>Cover stock<select value={recipe.stock} disabled={disabled} onChange={event =>
      onChange({ ...recipe, stock: event.currentTarget.value as PaperStockPreset, approvedDimensions: undefined })}>
      {Object.keys(PAPER_STOCK_PRESETS).filter(key => key !== 'custom').map(key => <option value={key} key={key}>{key.replaceAll('-', ' ')}</option>)}
    </select></label>
    <label>Cover binding<select value={recipe.binding} disabled={disabled} onChange={event =>
      onChange({ ...recipe, binding: event.currentTarget.value as DeliveryBinding, approvedDimensions: undefined })}>
      {DELIVERY_BINDINGS.map(binding => <option value={binding} key={binding}>{binding.replaceAll('-', ' ')}</option>)}
    </select></label>
    <p>{dimensions.pageCount} interior pages · {dimensions.spine} mm spine</p>
    <p>Required cover trim {dimensions.width} × {dimensions.height} mm · {dimensions.bleed} mm bleed</p>
    <label>Cover .recto file<input type="file" accept=".recto,.json" disabled={disabled} onChange={event => {
      const input = event.currentTarget, file = input.files?.[0];
      input.value = '';
      if (file) onCover(file);
    }}/></label>
    {recipe.cover && <p>{recipe.cover.settings.title} · {recipe.cover.settings.widthMm} × {recipe.cover.settings.heightMm} mm</p>}
    {recipe.cover && !dimensions.matches && <p role="alert">The cover does not match the current trim and bleed. Review its dimensions and select the revised cover.</p>}
    {dimensions.matches && <p>{approved ? 'Cover dimensions approved.' : 'Review the cover against the current spine before delivery.'}</p>}
    <div className="publication-actions">
      <button className="sm-btn" disabled={disabled || !dimensions.matches || approved}
        onClick={() => onChange({ ...recipe, approvedDimensions: dimensions.signature })}>Approve cover dimensions</button>
      <button className="sm-btn" disabled={disabled || !approved} onClick={onExport}>Export book package</button>
    </div>
  </details>;
}
