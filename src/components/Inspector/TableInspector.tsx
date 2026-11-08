import { useState } from 'preact/hooks';
import { stateManager } from '../../state';
import type { TableElement, TableCell } from '../../types';
import { parseTableData } from '../../engine/delimitedText';
import { mergeTableCellRight, tableCellSpan, tableThread } from '../../engine/tableCells';
import { layoutContentTables } from '../../engine/tableLayout';

export default function TableInspector({ element: frame }: { element: TableElement }) {
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null);
  const [tableData, setTableData] = useState('');
  const [tableError, setTableError] = useState('');
  const [linkTarget, setLinkTarget] = useState('');
  const thread = tableThread(stateManager.getState().spreads, frame);
  const element = thread[0];
  const locked = thread.some(item => item.locked || stateManager.getState().layers.find(layer => layer.id === item.layerId)?.locked);
  const layout = element.rowSizing === 'content' ? layoutContentTables(thread) : null;
  const act = (action: () => void) => { try { action(); setTableError(''); } catch (reason) { setTableError(reason instanceof Error ? reason.message : String(reason)); } };
  const update = (_id: string, updates: Parameters<typeof stateManager.updateTableSource>[1]) => act(() => stateManager.updateTableSource(frame.id, updates));

  const handleRowsChange = (e: Event) => {
    const newRows = Math.max(1, Math.min(20, parseInt((e.target as HTMLInputElement).value, 10) || 1));
    if (newRows === element.rows) return;
    const newCells: TableCell[][] = [];
    for (let r = 0; r < newRows; r++) {
      if (r < element.rows) {
        newCells.push([...element.cells[r]]);
      } else {
        const rowArr: TableCell[] = [];
        for (let c = 0; c < element.cols; c++) {
          rowArr.push({ text: `R${r + 1}C${c + 1}`, align: 'left' });
        }
        newCells.push(rowArr);
      }
    }
    update(element.id, { rows: newRows, cells: newCells });
  };

  const handleColsChange = (e: Event) => {
    const newCols = Math.max(1, Math.min(10, parseInt((e.target as HTMLInputElement).value, 10) || 1));
    if (newCols === element.cols) return;
    const newCells: TableCell[][] = element.cells.map((rowArr, r) => {
      const nextRow = [...rowArr];
      while (nextRow.length < newCols) {
        nextRow.push({ text: `R${r + 1}C${nextRow.length + 1}`, align: 'left' });
      }
      return nextRow.slice(0, newCols);
    });
    update(element.id, { cols: newCols, cells: newCells });
  };

  const handleCellTextChange = (row: number, col: number, text: string) => {
    act(() => stateManager.updateTableCell(frame.id, row, col, text));
  };

  const activeCell = selectedCell && element.cells[selectedCell.row] && element.cells[selectedCell.row][selectedCell.col]
    ? element.cells[selectedCell.row][selectedCell.col]
    : null;

  return (
    <div className="inspector-section">
      <div className="section-header">TABLE STRUCTURE</div>
      <details className="publication-panel"><summary>Table continuation</summary>
        <p>Content-sized rows wrap text and continue as whole rows into the next frame. Equal rows preserves the existing layout. Cell and style edits apply across the table.</p>
        <label>Row sizing<select aria-label="Table row sizing" value={element.rowSizing || 'equal'} disabled={locked} onChange={event => act(() => stateManager.setTableRowSizing(frame.id, event.currentTarget.value as 'equal' | 'content'))}>
          <option value="equal">Equal rows (legacy)</option><option value="content">Fit rows to content</option>
        </select></label>
        {layout && <p role="status">{layout.pendingRows.length ? `${layout.pendingRows.length} rows need more space. Add a continuation page or enlarge the frame; a row must fit in one frame.` : 'All body rows fit.'}{layout.frames.some(item => item.horizontalOverflow) ? ' Text or repeated headers/footers exceed a frame.' : ''}</p>}
        <button className="sm-btn" disabled={locked || !!frame.pasteboard} onClick={() => act(() => { stateManager.addTableContinuationPage(frame.id); })}>Add continuation page</button>
        <label>Next table frame<select value={linkTarget} onChange={event => setLinkTarget(event.currentTarget.value)}><option value="">Choose a table</option>{stateManager.getState().spreads.flatMap(spread => spread.elements.filter((item): item is TableElement => item.type === 'table' && !thread.some(frame => frame.id === item.id)).map(item => <option key={item.id} value={item.id}>{item.id} · page {spread.pages.find(page => page.id === item.pageId)?.pageNumber}</option>))}</select></label>
        <button className="sm-btn" disabled={!linkTarget || !!frame.nextFrameId || locked} onClick={() => setTableError(stateManager.linkTableFrames(frame.id, linkTarget) ? 'Table continuation linked.' : 'Unlock both tables and choose an unlinked target outside this chain.')}>Link next frame</button>
        <button className="sm-btn" disabled={locked || (!frame.nextFrameId && !frame.prevFrameId)} onClick={() => { stateManager.unlinkTableFrame(frame.id); setTableError('Table frame unlinked.'); }}>Unlink table frame</button>
      </details>
      <details className="publication-panel"><summary>Import table data</summary>
        <p>Paste tab-separated cells from a spreadsheet, or quoted CSV. Replaces this table’s cells in one undo step. Unlink threaded tables before replacing their structure.</p>
        <textarea aria-label="Table CSV or TSV data" rows={5} value={tableData} onInput={event => setTableData(event.currentTarget.value)}/>
        <button className="sm-btn" disabled={locked || !tableData.trim() || !!element.prevFrameId || !!element.nextFrameId} onClick={() => {
          try { const rows = parseTableData(tableData); update(element.id, { rows: rows.length, cols: rows[0].length, cells: rows.map(row => row.map(text => ({ text, align: 'left' as const }))) }); setSelectedCell(null); setTableError('Table imported.'); }
          catch (reason) { setTableError(reason instanceof Error ? reason.message : String(reason)); }
        }}>Replace table data</button>
      </details>
      {tableError && <p role="status">{tableError}</p>}
      <label className="publication-check"><input type="checkbox" checked={frame.repeatHeaderOnOverflow !== false} disabled={locked} onChange={event => stateManager.updateElement(frame.id, { repeatHeaderOnOverflow: event.currentTarget.checked })}/>Repeat headers in linked frames</label>
      <div className="input-grid-2">
        <label>
          Rows:
          <input
            type="number"
            min={1}
            max={20}
            value={element.rows}
            disabled={locked}
            onChange={handleRowsChange}
          />
        </label>
        <label>
          Columns:
          <input
            type="number"
            min={1}
            max={10}
            value={element.cols}
            disabled={locked}
            onChange={handleColsChange}
          />
        </label>
      </div>

      <div className="input-grid-2" style={{ marginTop: '8px' }}>
        <label>
          Header Row:
          <input
            type="checkbox"
            checked={element.headerRowCount > 0}
            disabled={locked}
            onChange={(e) =>
              update(element.id, {
                headerRowCount: (e.target as HTMLInputElement).checked ? 1 : 0,
              })
            }
          />
        </label>
        <label>
          Alt Row Fill:
          <input
            type="color"
            value={element.alternateRowColor || '#f9f9f9'}
            disabled={locked}
            onInput={(e) =>
              update(element.id, {
                alternateRowColor: (e.target as HTMLInputElement).value,
              })
            }
          />
        </label>
      </div>

      <div className="input-grid-2" style={{ marginTop: '8px' }}>
        <label>
          Border Width:
          <input
            type="number"
            min={0}
            max={5}
            step={0.1}
            value={element.borderWidthMm}
            disabled={locked}
            onInput={(e) =>
              update(element.id, {
                borderWidthMm: parseFloat((e.target as HTMLInputElement).value) || 0,
              })
            }
          />
          mm
        </label>
        <label>
          Border Color:
          <input
            type="color"
            value={element.borderColor}
            disabled={locked}
            onInput={(e) =>
              update(element.id, {
                borderColor: (e.target as HTMLInputElement).value,
              })
            }
          />
        </label>
      </div>

      <div className="input-grid-2" style={{ marginTop: '8px' }}>
        <label>
          Font Size:
          <input
            type="number"
            min={6}
            max={48}
            step={0.5}
            value={element.fontSizePt}
            disabled={locked}
            onInput={(e) =>
              update(element.id, {
                fontSizePt: parseFloat((e.target as HTMLInputElement).value) || 9,
              })
            }
          />
          pt
        </label>
        <label>
          Padding:
          <input
            type="number"
            min={0}
            max={10}
            step={0.5}
            value={element.cellPaddingMm}
            disabled={locked}
            onInput={(e) =>
              update(element.id, {
                cellPaddingMm: Math.max(0, Math.min(10, Number((e.target as HTMLInputElement).value) || 0)),
              })
            }
          />
          mm
        </label>
      </div>

      <div style={{ marginTop: '12px' }}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: '#aaa', marginBottom: '6px' }}>
          CELL MATRIX (CLICK CELL TO EDIT)
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${element.cols}, 1fr)`,
            gap: '2px',
            maxHeight: '160px',
            overflowY: 'auto',
            background: '#1a1a1a',
            padding: '4px',
            borderRadius: '4px',
            border: '1px solid #333',
          }}
        >
          {element.cells.map((rowArr, r) =>
            rowArr.map((cell, c) => {
              const span = tableCellSpan(rowArr, c); if (!span) return null;
              const isSelected = selectedCell?.row === r && selectedCell?.col === c;
              const isHdr = r < element.headerRowCount;
              return (
                <div
                  key={`${r}-${c}`}
                  onClick={() => setSelectedCell({ row: r, col: c })}
                  style={{
                    gridColumn: `span ${span}`,
                    padding: '4px 6px',
                    fontSize: '10px',
                    background: isSelected
                      ? '#3b82f6'
                      : isHdr
                      ? '#333'
                      : r % 2 === 1
                      ? '#222'
                      : '#2a2a2a',
                    color: isSelected ? '#fff' : isHdr ? '#fbbf24' : '#e0e0e0',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    border: isSelected ? '1px solid #fff' : '1px solid #444',
                    borderRadius: '2px',
                  }}
                  title={`Row ${r + 1}, Col ${c + 1}: ${cell.text}`}
                >
                  {cell.text || '∅'}
                </div>
              );
            })
          )}
        </div>
      </div>

      {activeCell && selectedCell && (
        <div style={{ marginTop: '10px', background: '#252525', padding: '8px', borderRadius: '4px' }}>
          <div className="publication-actions">
            <button className="sm-btn" disabled={locked || selectedCell.col + (activeCell.colSpan || 1) >= element.cols} onClick={() => {
              try { update(element.id, { cells: mergeTableCellRight(element.cells, selectedCell.row, selectedCell.col) }); setTableError('Cells merged. Their text is retained in the first cell.'); } catch (reason) { setTableError(String(reason)); }
            }}>Merge cell right</button>
            <button className="sm-btn" disabled={locked || !activeCell.colSpan || activeCell.colSpan === 1} onClick={() => {
              const cells = structuredClone(element.cells); delete cells[selectedCell.row][selectedCell.col].colSpan; update(element.id, { cells });
            }}>Split merged cell</button>
          </div>
          <div style={{ fontSize: '11px', color: '#93c5fd', marginBottom: '4px', fontWeight: 600 }}>
            Editing Cell [R{selectedCell.row + 1}, C{selectedCell.col + 1}]:
          </div>
          <input
            type="text"
            value={activeCell.text}
            aria-label="Selected table cell text"
            disabled={locked}
            style={{ width: '100%', boxSizing: 'border-box' }}
            onInput={(e) =>
              handleCellTextChange(
                selectedCell.row,
                selectedCell.col,
                (e.target as HTMLInputElement).value
              )
            }
          />
          <div className="btn-group-sm" style={{ marginTop: '6px' }}>
            <button
              className={`sm-btn ${activeCell.align === 'left' || !activeCell.align ? 'active' : ''}`}
              onClick={() => {
                const newCells = element.cells.map((r, rIdx) =>
                  r.map((c, cIdx) =>
                    rIdx === selectedCell.row && cIdx === selectedCell.col ? { ...c, align: 'left' as const } : c
                  )
                );
                update(element.id, { cells: newCells });
              }}
            >
              Align L
            </button>
            <button
              className={`sm-btn ${activeCell.align === 'center' ? 'active' : ''}`}
              onClick={() => {
                const newCells = element.cells.map((r, rIdx) =>
                  r.map((c, cIdx) =>
                    rIdx === selectedCell.row && cIdx === selectedCell.col ? { ...c, align: 'center' as const } : c
                  )
                );
                update(element.id, { cells: newCells });
              }}
            >
              Align C
            </button>
            <button
              className={`sm-btn ${activeCell.align === 'right' ? 'active' : ''}`}
              onClick={() => {
                const newCells = element.cells.map((r, rIdx) =>
                  r.map((c, cIdx) =>
                    rIdx === selectedCell.row && cIdx === selectedCell.col ? { ...c, align: 'right' as const } : c
                  )
                );
                update(element.id, { cells: newCells });
              }}
            >
              Align R
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
