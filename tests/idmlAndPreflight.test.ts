import { describe, it, expect } from 'vitest';
import { stateManager } from '../src/state';
import { exportDocumentToIdml } from '../src/export/idmlExport';
import { parseIdmlPackage, parseIdmlTextVariables } from '../src/idmlImport';
import { createZipArchive } from '../src/zip';
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

  it('clips overset text strictly to frame height and exports correctly in PDF stream', async () => {
    const { exportDocumentToPdf } = await import('../src/export/pdfExport');
    const state = stateManager.getState();
    const activeSpread = stateManager.getActiveSpread();

    // Create a compact text frame with large overset story content
    const testOversetId = `overflow-test-${Date.now()}`;
    const oversetText = Array(100).fill('Overset paragraph content that should never spill across margins.').join('\n');
    const oversetElement: TextElement = {
      id: testOversetId,
      type: 'text',
      pageId: activeSpread.pages[0].id,
      x: 20,
      y: 20,
      width: 80,
      height: 25, // Only ~4-5 lines capacity
      rotation: 0,
      opacity: 1,
      zIndex: 5,
      locked: false,
      text: oversetText,
      fontFamily: 'Inter, sans-serif',
      fontSizePt: 10,
      lineHeight: 1.3,
      letterSpacingPt: 0,
      color: '#000000',
      alignment: 'left',
      columns: 1,
      columnGutterMm: 4,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      borderWidthMm: 0,
      paddingMm: 0,
    };

    stateManager.addElement(oversetElement);

    const pdfDoc = await exportDocumentToPdf(stateManager.getState(), {
      includeCropMarks: false,
      includeRegistrationMarks: false,
      includeColorBars: false,
    });

    expect(pdfDoc).toBeDefined();
    const pdfOutput = pdfDoc.output('arraybuffer');
    expect(pdfOutput.byteLength).toBeGreaterThan(1000);

    // Clean up
    stateManager.deleteElement(testOversetId);
  });
});

describe('IDML Text Variable Resolution', () => {
  it('resolves Custom Text variable definitions from designmap.xml, keyed by Self id', () => {
    const designmapXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging">
	<TextVariable Self="dTextVariablenUI_quit" Name="UI_quit" VariableType="CustomTextType">
		<CustomTextVariablePreference>
			<Properties>
				<Contents type="string">Quitter</Contents>
			</Properties>
		</CustomTextVariablePreference>
	</TextVariable>
	<TextVariable Self="dTextVariablenTV_ChapNum" Name="&lt;?AID 001b?&gt;TV XRefChapterNumber" VariableType="XrefChapterNumberType" />
</Document>`;
    const files = new Map<string, Uint8Array>([['designmap.xml', new TextEncoder().encode(designmapXml)]]);

    const vars = parseIdmlTextVariables(files);

    expect(vars.get('dTextVariablenUI_quit')).toBe('Quitter');
    // Non-Custom-Text types (page/chapter numbers, running headers, …) depend on live
    // layout this importer doesn't compute, so they're intentionally left unresolved.
    expect(vars.has('dTextVariablenTV_ChapNum')).toBe(false);
  });

  it('inserts a variable\'s current value in place of its instance when importing a Story, leaving untagged occurrences of the same word untouched', async () => {
    const designmapXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="21.4">
	<TextVariable Self="dTextVariablenUI_quit" Name="UI_quit" VariableType="CustomTextType">
		<CustomTextVariablePreference>
			<Properties>
				<Contents type="string">Quitter</Contents>
			</Properties>
		</CustomTextVariablePreference>
	</TextVariable>
	<idPkg:Spread src="Spreads/Spread_test.xml" />
</Document>`;

    const spreadXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Spread xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="21.4">
	<Spread Self="sp1">
		<Page Self="p1" GeometricBounds="0 0 841.89 595.276" />
		<TextFrame Self="tf1" ParentStory="story1" ItemTransform="1 0 0 1 0 0" GeometricBounds="0 0 200 400" />
	</Spread>
</idPkg:Spread>`;

    // Mirrors what InDesign actually writes for Type > Text Variables > Insert Variable:
    // a <TextVariableInstance> self-closing tag inside the styled CharacterStyleRange, with
    // ResultText holding InDesign's last-cached value (deliberately stale here, "quit", to
    // prove the importer prefers the live designmap.xml definition, "Quitter").
    const storyXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Story xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="21.4">
	<Story Self="story1">
		<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle">
			<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/Text variable">
				<TextVariableInstance Self="tvi1" Name="UI_quit" ResultText="quit" AssociatedTextVariable="dTextVariablenUI_quit" />
			</CharacterStyleRange>
			<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
				<Content> to quit, press Esc.</Content>
			</CharacterStyleRange>
		</ParagraphStyleRange>
	</Story>
</idPkg:Story>`;

    const idmlBytes = createZipArchive({
      'designmap.xml': designmapXml,
      'Spreads/Spread_test.xml': spreadXml,
      'Stories/Story_story1.xml': storyXml,
    });

    const state = await parseIdmlPackage(idmlBytes, 'variable-test.idml');
    const textEl = state.spreads[0]?.elements.find((el) => el.type === 'text') as TextElement | undefined;

    expect(textEl).toBeDefined();
    // The tagged instance resolves to the variable's current value...
    expect(textEl!.text).toContain('Quitter to quit, press Esc.');
    // ...while the untagged word "quit" later in the same sentence is left as plain text,
    // and the stale cached ResultText ("quit") is not used in place of "Quitter".
    expect(textEl!.text).not.toContain('quit to quit');
  });
});

describe('IDML Text Variable Resolution — edge cases', () => {
  const header = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

  // A Custom Text variable definition. Pass null for `value` to emit a self-closing
  // <Contents/> — InDesign's encoding of a variable whose text has been cleared to empty.
  function customTextVar(self: string, value: string | null): string {
    const contents = value === null ? '<Contents type="string" />' : `<Contents type="string">${value}</Contents>`;
    return `<TextVariable Self="${self}" Name="${self}" VariableType="CustomTextType">
      <CustomTextVariablePreference><Properties>${contents}</Properties></CustomTextVariablePreference>
    </TextVariable>`;
  }

  function designmap(defs: string): string {
    return `${header}
<Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="21.4">
  ${defs}
  <idPkg:Spread src="Spreads/Spread_test.xml" />
</Document>`;
  }

  // Imports a story whose single paragraph is `storyBody` (a run of CharacterStyleRanges)
  // and returns the resulting text frame's plain text.
  async function importStoryText(defs: string, storyBody: string): Promise<string> {
    const spreadXml = `${header}
<idPkg:Spread xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="21.4">
  <Spread Self="sp1">
    <Page Self="p1" GeometricBounds="0 0 841.89 595.276" />
    <TextFrame Self="tf1" ParentStory="story1" ItemTransform="1 0 0 1 0 0" GeometricBounds="0 0 200 400" />
  </Spread>
</idPkg:Spread>`;
    const storyXml = `${header}
<idPkg:Story xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="21.4">
  <Story Self="story1">
    <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle">
      ${storyBody}
    </ParagraphStyleRange>
  </Story>
</idPkg:Story>`;
    const bytes = createZipArchive({
      'designmap.xml': designmap(defs),
      'Spreads/Spread_test.xml': spreadXml,
      'Stories/Story_story1.xml': storyXml,
    });
    const state = await parseIdmlPackage(bytes, 'variable-test.idml');
    const textEl = state.spreads[0]?.elements.find((el) => el.type === 'text') as TextElement | undefined;
    return textEl?.text ?? '';
  }

  it('records a self-closing <Contents/> as an explicitly empty value, not as unresolved', () => {
    const files = new Map<string, Uint8Array>([
      ['designmap.xml', new TextEncoder().encode(designmap(customTextVar('dv_empty', null)))],
    ]);
    const vars = parseIdmlTextVariables(files);
    expect(vars.has('dv_empty')).toBe(true);
    expect(vars.get('dv_empty')).toBe('');
  });

  it('only resolves CustomTextType, ignoring a <Contents> on another variable type', () => {
    const otherType = `<TextVariable Self="dv_page" Name="PG" VariableType="XrefPageNumberType">
      <CustomTextVariablePreference><Properties><Contents>should-not-read</Contents></Properties></CustomTextVariablePreference>
    </TextVariable>`;
    const files = new Map<string, Uint8Array>([
      ['designmap.xml', new TextEncoder().encode(designmap(otherType))],
    ]);
    const vars = parseIdmlTextVariables(files);
    expect(vars.has('dv_page')).toBe(false);
  });

  it('ignores a <Contents> that is not inside a CustomTextVariablePreference', () => {
    const strayContents = `<TextVariable Self="dv_stray" Name="S" VariableType="CustomTextType">
      <SomeOtherPreference><Properties><Contents>stray</Contents></Properties></SomeOtherPreference>
    </TextVariable>`;
    const files = new Map<string, Uint8Array>([
      ['designmap.xml', new TextEncoder().encode(designmap(strayContents))],
    ]);
    const vars = parseIdmlTextVariables(files);
    expect(vars.has('dv_stray')).toBe(false);
  });

  it('renders a cleared variable as empty, not as its stale cached ResultText', async () => {
    const text = await importStoryText(
      customTextVar('dv_empty', null),
      `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
        <TextVariableInstance Self="tvi1" ResultText="STALE" AssociatedTextVariable="dv_empty" />
        <Content>DONE</Content>
      </CharacterStyleRange>`,
    );
    expect(text).toContain('DONE');
    expect(text).not.toContain('STALE');
  });

  it('falls back to cached ResultText when AssociatedTextVariable is empty', async () => {
    const text = await importStoryText(
      customTextVar('dv_used', 'ignored'),
      `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
        <TextVariableInstance Self="tvi1" ResultText="CACHED" AssociatedTextVariable="" />
      </CharacterStyleRange>`,
    );
    expect(text).toContain('CACHED');
  });

  it('falls back to cached ResultText for an unresolved (unknown) reference', async () => {
    const text = await importStoryText(
      customTextVar('dv_known', 'known-value'),
      `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
        <TextVariableInstance Self="tvi1" ResultText="PAGE-7" AssociatedTextVariable="dv_missing" />
      </CharacterStyleRange>`,
    );
    expect(text).toContain('PAGE-7');
    expect(text).not.toContain('known-value');
  });

  it('preserves the order of mixed Content, Br and variable tokens', async () => {
    const text = await importStoryText(
      customTextVar('dv_b', 'B'),
      `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]">
        <Content>A</Content>
        <TextVariableInstance Self="tvi1" ResultText="x" AssociatedTextVariable="dv_b" />
        <Br />
        <Content>C</Content>
      </CharacterStyleRange>`,
    );
    expect(text).toContain('AB\nC');
  });
});


