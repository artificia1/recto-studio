export interface SheetPlanInput {
  sheetWidth: number; sheetHeight: number;
  pieceWidth: number; pieceHeight: number;
  margin: number; gap: number; quantity: number; allowRotation: boolean;
}

/** Conservative rectangular grid planning; never assumes interlocking flaps. Units: mm. */
export function planSheet(input: SheetPlanInput) {
  for (const key of ['sheetWidth', 'sheetHeight', 'pieceWidth', 'pieceHeight'] as const) {
    if (!Number.isFinite(input[key]) || input[key] < 1 || input[key] > 2500) throw new Error('Sheet and piece dimensions must be between 1 and 2,500 mm.');
  }
  if (![input.margin, input.gap].every(value => Number.isFinite(value) && value >= 0 && value <= 2500)) throw new Error('Margins and gaps must be finite, non-negative millimetres.');
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 10000) throw new Error('Quantity must be between 1 and 10,000.');
  const availableWidth = Math.max(0, input.sheetWidth - 2 * input.margin);
  const availableHeight = Math.max(0, input.sheetHeight - 2 * input.margin);
  const grid = (rotated: boolean) => {
    const width = rotated ? input.pieceHeight : input.pieceWidth;
    const height = rotated ? input.pieceWidth : input.pieceHeight;
    const columns = Math.max(0, Math.floor((availableWidth + input.gap) / (width + input.gap)));
    const rows = Math.max(0, Math.floor((availableHeight + input.gap) / (height + input.gap)));
    return { width, height, columns, rows, capacity: columns * rows, rotated };
  };
  let layout = grid(false);
  const alternative = grid(true);
  if (input.allowRotation && alternative.capacity > layout.capacity) layout = alternative;
  const placed = Math.min(input.quantity, layout.capacity);
  const placements = Array.from({ length: placed }, (_, index) => ({
    x: input.margin + (index % layout.columns) * (layout.width + input.gap),
    y: input.margin + Math.floor(index / layout.columns) * (layout.height + input.gap),
    width: layout.width, height: layout.height, rotation: layout.rotated ? 90 : 0,
  }));
  return { input, method: 'uniform rectangular grid', ...layout, placements,
    sheetsRequired: layout.capacity ? Math.ceil(input.quantity / layout.capacity) : null,
    unplacedOnFirstSheet: input.quantity - placed,
    firstSheetAreaUtilization: placed * input.pieceWidth * input.pieceHeight / (input.sheetWidth * input.sheetHeight),
    warning: 'Planning only. Grain direction, gripper bars, bleed, flaps and tooling clearance must be verified. This is not a dieline or a press file.' };
}
