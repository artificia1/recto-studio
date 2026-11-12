import { expect, it } from 'vitest';
import { parseIdmlPackage } from '../src/idmlImport';
import { createZipArchive } from '../src/zip';

it('imports InDesign paragraph returns, forced breaks, alignment and null frame references together', async () => {
  const project = await parseIdmlPackage(createZipArchive({
    'designmap.xml': '<Document><idPkg:Spread src="Spreads/Spread_story.xml"/></Document>',
    'Spreads/Spread_story.xml': `<Spread Self="spread"><Page Self="page" GeometricBounds="0 0 842 595"/>
      <TextFrame Self="frame" ParentStory="story" PreviousTextFrame="n" NextTextFrame="n"
        ItemTransform="1 0 0 1 0 0" GeometricBounds="20 20 720 550"/></Spread>`,
    'Resources/Styles.xml': `<Styles>
      <ParagraphStyle Self="ParagraphStyle/Opening" Name="Opening" SingleWordJustification="LeftAlign" Justification="CenterAlign"/>
      <ParagraphStyle Self="ParagraphStyle/Body" Name="Body" Justification="LeftAlign"/>
    </Styles>`,
    'Stories/Story_story.xml': `<Story Self="story">
      <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Opening">
        <CharacterStyleRange><Content>Opening line</Content><Br/><Content>Second line</Content><Br/></CharacterStyleRange>
      </ParagraphStyleRange>
      <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Body">
        <CharacterStyleRange><Content>Body copy</Content><Br/></CharacterStyleRange>
      </ParagraphStyleRange>
      <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Body">
        <CharacterStyleRange><Content>Closing copy</Content></CharacterStyleRange>
      </ParagraphStyleRange>
    </Story>`,
  }), 'indesign-story.idml');

  const opening = project.paragraphStyles.find(style => style.name === 'Opening');
  const body = project.paragraphStyles.find(style => style.name === 'Body');
  const frame = project.spreads[0].elements.find(element => element.type === 'text');
  expect(opening?.alignment).toBe('center');
  expect(body?.alignment).toBe('left');
  expect(frame?.prevFrameId).toBeUndefined();
  expect(frame?.nextFrameId).toBeUndefined();
  expect(frame?.text).toBe('Opening line\nSecond line\nBody copy\nClosing copy');
  expect(frame?.storyContent?.paragraphs.map(paragraph => paragraph.styleId))
    .toEqual([opening?.id, opening?.id, body?.id, body?.id]);
});
