import { describe, it, expect } from 'vitest';
import { stateManager } from '../src/state';
import { exportDocumentToIdml } from '../src/export/idmlExport';
import { ShapeElement, TextElement } from '../src/types';

describe('IDML Package Export & Prepress Preflight Intelligence', () => {
  it('exports a valid Adobe InDesign IDML archive with full XML directory structure', () => {
    const state = stateManager.getState();
    const idmlBytes = exportDocumentToIdml(state);

    expect(idmlBytes).toBeInstanceOf(Uint8Array);
    expect(idmlBytes.length).toBeGreaterThan(500);

    // Verify PK zip signature (0x50, 0x4B, 0x03, 0x04)
    expect(idmlBytes[0]).toBe(0x50);
    expect(idmlBytes[1]).toBe(0x4B);
    expect(idmlBytes[2]).toBe(0x03);
    expect(idmlBytes[3]).toBe(0x04);

    // Decode zip contents to ensure required IDML components are present
    const binaryStr = new TextDecoder('latin1').decode(idmlBytes);
    expect(binaryStr).toContain('mimetype');
    expect(binaryStr).toContain('application/vnd.adobe.indesign-idml-package');
    expect(binaryStr).toContain('META-INF/container.xml');
    expect(binaryStr).toContain('designmap.xml');
    expect(binaryStr).toContain('Resources/Preferences.xml');
    expect(binaryStr).toContain('Resources/Styles.xml');
    expect(binaryStr).toContain('Spreads/Spread_');
    expect(binaryStr).toContain('Stories/Story_');
  });

  it('detects Total Area Coverage (TAC > 300%) ink density hazard and auto-fixes it', () => {
    // Add shape with over-inked CMYK color (80% + 80% + 80% + 90% = 330% TAC)
    const hotShapeId = `tac-shape-${Date.now()}`;
    const hotShape: ShapeElement = {
      id: hotShapeId,
      type: 'shape',
      shapeKind: 'rectangle',
      pageId: 'page-1',
      x: 30,
      y: 30,
      width: 50,
      height: 50,
      rotation: 0,
      opacity: 1,
      zIndex: 1,
      locked: false,
      fillColor: 'cmyk(80%, 80%, 80%, 90%)',
      strokeColor: '#000000',
      strokeWidthMm: 0.5,
    };
    stateManager.addElement(hotShape);

    const issues = stateManager.runPreflightCheck();
    const tacIssue = issues.find((i) => i.code === 'TAC_INK_DENSITY' && i.elementId === hotShapeId);
    expect(tacIssue).toBeDefined();
    expect(tacIssue?.severity).toBe('warning');
    expect(tacIssue?.message).toContain('330%');

    // Auto fix
    const fixed = stateManager.autoFixPreflightIssue(tacIssue!);
    expect(fixed).toBe(true);

    const updatedShape = stateManager.getElementById(hotShapeId) as ShapeElement;
    expect(updatedShape.fillColor).toBe('#1a1a1a');

    // Clean up
    stateManager.deleteElement(hotShapeId);
  });

  it('toggles CMYK plate solo states correctly', () => {
    stateManager.setPlateSolo('cyan');
    expect(stateManager.getState().plateSolo).toBe('cyan');

    stateManager.setPlateSolo('black');
    expect(stateManager.getState().plateSolo).toBe('black');

    stateManager.setPlateSolo('all');
    expect(stateManager.getState().plateSolo).toBe('all');
  });
});
