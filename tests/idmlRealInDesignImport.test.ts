import { describe, it, expect } from 'vitest';
import { parseIdmlPackage, extractXmlAttr } from '../src/idmlImport';
import { createZipArchive } from '../src/zip';
import { TextElement } from '../src/types';

const HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function buildIdml(storyBody: string, stylesXml = ''): Uint8Array {
  const designmap = `${HEADER}
<Document xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="21.4">
  <idPkg:Spread src="Spreads/Spread_test.xml" />
</Document>`;
  // A standalone InDesign frame: "n" means no linked previous/next frame.
  const spread = `${HEADER}
<idPkg:Spread xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="21.4">
  <Spread Self="sp1">
    <Page Self="p1" GeometricBounds="0 0 841.89 595.276" />
    <TextFrame Self="tf1" ParentStory="story1" PreviousTextFrame="n" NextTextFrame="n" ItemTransform="1 0 0 1 0 0" GeometricBounds="0 0 200 400" />
  </Spread>
</idPkg:Spread>`;
  const story = `${HEADER}
<idPkg:Story xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging" DOMVersion="21.4">
  <Story Self="story1">
    ${storyBody}
  </Story>
</idPkg:Story>`;
  const files: Record<string, string> = {
    'designmap.xml': designmap,
    'Spreads/Spread_test.xml': spread,
    'Stories/Story_story1.xml': story,
  };
  if (stylesXml) {
    files['Resources/Styles.xml'] = `${HEADER}
<idPkg:Styles xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging">
  <RootParagraphStyleGroup Self="rpsg">${stylesXml}</RootParagraphStyleGroup>
</idPkg:Styles>`;
  }
  return createZipArchive(files);
}

// A paragraph as InDesign writes it: one ParagraphStyleRange ending with a <Br/> paragraph return.
const paraBr = (style: string, text: string) =>
  `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/${style}"><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>${text}</Content><Br /></CharacterStyleRange></ParagraphStyleRange>`;
const paraLast = (style: string, text: string) =>
  `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/${style}"><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>${text}</Content></CharacterStyleRange></ParagraphStyleRange>`;

async function importTextEl(storyBody: string, stylesXml = ''): Promise<TextElement> {
  const state = await parseIdmlPackage(buildIdml(storyBody, stylesXml), 'test.idml');
  const el = state.spreads.flatMap((s) => s.elements).find((e) => e.type === 'text') as TextElement | undefined;
  if (!el) throw new Error('no text frame imported');
  return el;
}

describe('extractXmlAttr', () => {
  it('matches a whole attribute name, not the tail of a longer one', () => {
    const tag = '<ParagraphStyle SingleWordJustification="LeftAlign" Justification="CenterAlign">';
    expect(extractXmlAttr(tag, 'Justification')).toBe('CenterAlign');
  });

  it('still reads a normal attribute', () => {
    expect(extractXmlAttr('<X Name="Body Text" PointSize="14">', 'Name')).toBe('Body Text');
    expect(extractXmlAttr('<X PointSize="14">', 'PointSize')).toBe('14');
  });
});

describe('IDML import — real InDesign structure', () => {
  it('reads a style\'s own Justification, not SingleWordJustification', async () => {
    const styles = '<ParagraphStyle Self="ps-c" Name="Centered" SingleWordJustification="LeftAlign" Justification="CenterAlign" PointSize="14" />';
    const state = await parseIdmlPackage(buildIdml(paraLast('Centered', 'Hi'), styles), 'test.idml');
    const style = state.paragraphStyles.find((s) => s.name === 'Centered');
    expect(style?.alignment).toBe('center');
  });

  it('drops the trailing <Br/> at each paragraph end (no spurious blank lines)', async () => {
    const el = await importTextEl(paraBr('$ID/NormalParagraphStyle', 'First') + paraBr('$ID/NormalParagraphStyle', 'Second') + paraLast('$ID/NormalParagraphStyle', 'Third'));
    expect(el.text).toBe('First\nSecond\nThird');
  });

  it('keeps a <Br/> inside a paragraph as a forced line break', async () => {
    const el = await importTextEl(
      `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/$ID/NormalParagraphStyle"><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>Line one</Content><Br /><Content>Line two</Content></CharacterStyleRange></ParagraphStyleRange>`,
    );
    expect(el.text).toBe('Line one\nLine two');
  });

  it('treats InDesign "n" text-frame links as no link', async () => {
    const el = await importTextEl(paraLast('$ID/NormalParagraphStyle', 'Standalone frame'));
    expect(el.prevFrameId).toBeUndefined();
    expect(el.nextFrameId).toBeUndefined();
  });
});
