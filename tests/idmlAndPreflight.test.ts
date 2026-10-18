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
    stateManager.setPlateSolo('all');
    expect(stateManager.getState().plateSolo).toBe('all');
  });

  it('accurately resolves InDesign PathGeometry and ItemTransform avoiding coordinate collisions', async () => {
    const { parseElementSpreadBounds, parseSpreadPages } = await import('../src/idmlImport');
    const mockSpreadXml = `
      <Spread Self="Spread_test">
        <Page Self="p1" Name="1" GeometricBounds="0 0 576 360" ItemTransform="1 0 0 1 0 -288" />
        <TextFrame Self="tf1" ItemTransform="1 0 0 1 187.2 -81.56">
          <Properties>
            <PathGeometry>
              <GeometryPathType PathOpen="false">
                <PathPointArray>
                  <PathPointType Anchor="-136.8 -22.32" />
                  <PathPointType Anchor="-136.8 64.52" />
                  <PathPointType Anchor="136.8 64.52" />
                  <PathPointType Anchor="136.8 -22.32" />
                </PathPointArray>
              </GeometryPathType>
            </PathGeometry>
          </Properties>
        </TextFrame>
        <TextFrame Self="tf2" ItemTransform="1 0 0 1 187.2 72.72">
          <Properties>
            <PathGeometry>
              <GeometryPathType PathOpen="false">
                <PathPointArray>
                  <PathPointType Anchor="-136.8 -22.32" />
                  <PathPointType Anchor="-136.8 -0.72" />
                  <PathPointType Anchor="136.8 -0.72" />
                  <PathPointType Anchor="136.8 -22.32" />
                </PathPointArray>
              </GeometryPathType>
            </PathGeometry>
          </Properties>
        </TextFrame>
      </Spread>`;

    const pages = parseSpreadPages(mockSpreadXml, 1, false, 127, 203.2);
    expect(pages.length).toBe(1);
    expect(pages[0].spreadLeft).toBe(0);
    expect(pages[0].spreadTop).toBe(-288);

    const b1 = parseElementSpreadBounds(`<TextFrame Self="tf1" ItemTransform="1 0 0 1 187.2 -81.56"><Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray><PathPointType Anchor="-136.8 -22.32" /><PathPointType Anchor="136.8 64.52" /></PathPointArray></GeometryPathType></PathGeometry></Properties></TextFrame>`);
    const b2 = parseElementSpreadBounds(`<TextFrame Self="tf2" ItemTransform="1 0 0 1 187.2 72.72"><Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray><PathPointType Anchor="-136.8 -22.32" /><PathPointType Anchor="136.8 -0.72" /></PathPointArray></GeometryPathType></PathGeometry></Properties></TextFrame>`);

    const localY1Mm = Math.round((b1.spreadTop - pages[0].spreadTop) * (25.4 / 72) * 10) / 10;
    const localY2Mm = Math.round((b2.spreadTop - pages[0].spreadTop) * (25.4 / 72) * 10) / 10;

    expect(localY1Mm).toBeCloseTo(65.0, 0);
    expect(localY2Mm).toBeCloseTo(119.4, 0);
    expect(Math.abs(localY2Mm - localY1Mm)).toBeGreaterThan(30);
  });
});

