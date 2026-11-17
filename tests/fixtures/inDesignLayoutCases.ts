/**
 * Paragraph layout cases from two Russian-language books set in InDesign 21.4, for the features
 * the shared composer does not have yet: indents, space before and after, tab stops, auto leading
 * per line, and caps as a style property.
 *
 * Each case is one page with one text frame (no inset, as in the books). Style attributes are copied
 * from the books' IDML; the text is neutral placeholder copy. Where `measured` is given, it is what
 * InDesign's own PDF of the book shows, read with `pdftotext -bbox`; otherwise the value follows
 * from the style alone.
 */
import { createZipArchive } from '../../src/zip';

const PT = 25.4 / 72;
const mm = (pt: number) => Math.round(pt * PT * 100) / 100;

export interface LayoutCase {
  /** Text frame id after import (`idml-` + the IDML Self). */
  frameId: string;
  title: string;
  /** What InDesign does, in millimetres or points as named. */
  expect: Record<string, number | string>;
  measured?: boolean;
}

export const LAYOUT_CASES = {
  firstLineIndent: {
    frameId: 'idml-first-line',
    title: '"Text": first-line indent 11.34 pt, justified, Auto leading 130 % of 12 pt',
    expect: { firstLineIndentMm: mm(11.338582677165356), otherLinesIndentMm: 0, lineAdvancePt: 15.6 },
    measured: true,
  },
  hangingIndent: {
    frameId: 'idml-hanging',
    title: '"Footnote": left indent 11.34 pt with a first-line indent of -5.67 pt',
    expect: { firstLineIndentMm: mm(11.338582677165356 - 5.669291338582678), otherLinesIndentMm: mm(11.338582677165356) },
  },
  leftIndent: {
    frameId: 'idml-left-indent',
    title: '"Эпиграф": left indent 226.77 pt; "Text of stih": left indent 85.04 pt',
    expect: { epigraphIndentMm: mm(226.7716535433071), verseIndentMm: mm(85.03937007874016) },
    measured: true,
  },
  leftAndRightIndent: {
    frameId: 'idml-right-indent',
    title: '"Автор": centred between a left and a right indent of 11.34 pt each',
    expect: { leftIndentMm: mm(11.338582677165356), rightIndentMm: mm(11.338582677165356), alignment: 'center' },
  },
  spaceBeforeAndAfter: {
    frameId: 'idml-spacing',
    title: '"***" (18 pt, Auto 120 %) between "Text" paragraphs: space before 8.5 pt, after 5.67 pt',
    // Baseline of the last line before the separator to the first line after it:
    // 8.5 (before) + 21.6 (separator leading) + 5.67 (after) + 15.6 (body leading).
    expect: { spaceBeforePt: 8.503937007874017, spaceAfterPt: 5.669291338582678, baselineToBaselinePt: 51.37 },
    measured: true,
  },
  tabStops: {
    frameId: 'idml-tabs',
    title: 'Imprint: [Basic Paragraph] with local left tab stops at 100 and 110 pt, 9 pt type',
    expect: { columnAfterTabMm: mm(100), lineAdvancePt: 10.8 },
    measured: true,
  },
  rightTabWithLeader: {
    frameId: 'idml-contents',
    title: 'Contents line: right tab stop at 300 pt with a dot leader',
    expect: { pageNumberRightEdgeMm: mm(300), leader: '.' },
  },
  autoLeadingPerLine: {
    frameId: 'idml-tabs',
    title: 'Auto leading follows the largest type on the line: 9 pt runs in a 12 pt style advance 10.8 pt',
    expect: { lineAdvancePt: 10.8, styleSizePt: 12, runSizePt: 9 },
    measured: true,
  },
  allCaps: {
    frameId: 'idml-caps',
    title: 'All Caps from the paragraph style ("Рассказ") and on a character range (running head)',
    expect: { paragraphStyleShows: 'НАЗВАНИЕ РАССКАЗА', characterRangeShows: 'НАЗВАНИЕ КНИГИ', storyTextUnchanged: 'Название рассказа' },
  },
} satisfies Record<string, LayoutCase>;

// The styles involved, as the books define them. BasedOn names built-in styles without their prefix.
const styles = `<Styles>
  <RootCharacterStyleGroup><CharacterStyle Self="CharacterStyle/$ID/[No character style]" Name="$ID/[No character style]"/></RootCharacterStyleGroup>
  <RootParagraphStyleGroup>
    <ParagraphStyle Self="ParagraphStyle/$ID/[No paragraph style]" Name="$ID/[No paragraph style]" PointSize="12" Leading="Auto"
      AutoLeading="120" GridAlignment="None" FontStyle="Regular" Justification="LeftAlign" FirstLineIndent="0" LeftIndent="0"
      RightIndent="0" SpaceBefore="0" SpaceAfter="0" Capitalization="Normal" Tracking="0">
      <Properties><AppliedFont type="string">Minion Pro</AppliedFont></Properties>
    </ParagraphStyle>
    <ParagraphStyle Self="ParagraphStyle/$ID/NormalParagraphStyle" Name="$ID/NormalParagraphStyle">
      <Properties><BasedOn type="string">$ID/[No paragraph style]</BasedOn><AppliedFont type="string">Arial</AppliedFont></Properties>
    </ParagraphStyle>
    <ParagraphStyle Self="ParagraphStyle/Text" Name="Text" FirstLineIndent="11.338582677165356" AutoLeading="130" Justification="LeftJustified">
      <Properties><BasedOn type="string">$ID/[No paragraph style]</BasedOn><AppliedFont type="string">Arial</AppliedFont></Properties>
    </ParagraphStyle>
    <ParagraphStyle Self="ParagraphStyle/Text Italic" Name="Text Italic" FontStyle="Italic" FirstLineIndent="11.338582677165356" Justification="LeftJustified">
      <Properties><BasedOn type="string">$ID/[No paragraph style]</BasedOn><AppliedFont type="string">Arial</AppliedFont></Properties>
    </ParagraphStyle>
    <ParagraphStyle Self="ParagraphStyle/Footnote" Name="Footnote" PointSize="10" LeftIndent="11.338582677165356" FirstLineIndent="-5.669291338582678" Justification="LeftAlign">
      <Properties><BasedOn type="string">ParagraphStyle/Text Italic</BasedOn></Properties>
    </ParagraphStyle>
    <ParagraphStyle Self="ParagraphStyle/Эпиграф" Name="Эпиграф" FontStyle="Italic" PointSize="10" LeftIndent="226.7716535433071" FirstLineIndent="0" Justification="LeftAlign">
      <Properties><BasedOn type="string">ParagraphStyle/Text</BasedOn></Properties>
    </ParagraphStyle>
    <ParagraphStyle Self="ParagraphStyle/Text of stih" Name="Text of stih" LeftIndent="85.03937007874016" AutoLeading="130">
      <Properties><BasedOn type="string">$ID/[No paragraph style]</BasedOn><AppliedFont type="string">Arial</AppliedFont></Properties>
    </ParagraphStyle>
    <ParagraphStyle Self="ParagraphStyle/Автор" Name="Автор" FontStyle="Bold" PointSize="22" LeftIndent="11.338582677165356" RightIndent="11.338582677165356"
      FirstLineIndent="0" SpaceAfter="14.173228346456694" Justification="CenterAlign">
      <Properties><BasedOn type="string">ParagraphStyle/Text</BasedOn></Properties>
    </ParagraphStyle>
    <ParagraphStyle Self="ParagraphStyle/Рассказ" Name="Рассказ" FontStyle="Bold" PointSize="18" Capitalization="AllCaps" SpaceAfter="11.338582677165356" Justification="CenterAlign">
      <Properties><BasedOn type="string">$ID/[No paragraph style]</BasedOn><AppliedFont type="string">Arial</AppliedFont></Properties>
    </ParagraphStyle>
    <ParagraphStyle Self="ParagraphStyle/***" Name="***" FontStyle="Bold" PointSize="18" SpaceBefore="8.503937007874017" SpaceAfter="5.669291338582678">
      <Properties><BasedOn type="string">ParagraphStyle/Рассказ</BasedOn></Properties>
    </ParagraphStyle>
    <ParagraphStyle Self="ParagraphStyle/Master%3aLine UP" Name="Master:Line UP" PointSize="9" Justification="CenterAlign" FirstLineIndent="0">
      <Properties><BasedOn type="string">ParagraphStyle/Text</BasedOn></Properties>
    </ParagraphStyle>
    <ParagraphStyle Self="ParagraphStyle/Содержание%3aНазвание стиха в оглавлении" Name="Содержание:Название стиха в оглавлении" PointSize="11" FirstLineIndent="0" Justification="LeftAlign">
      <Properties><BasedOn type="string">ParagraphStyle/Text</BasedOn>
        <TabList type="list"><ListItem type="record"><Alignment type="enumeration">RightAlign</Alignment><AlignmentCharacter type="string">.</AlignmentCharacter>
          <Leader type="string">.</Leader><Position type="unit">300</Position></ListItem></TabList></Properties>
    </ParagraphStyle>
  </RootParagraphStyleGroup>
</Styles>`;

const tabStop = (position: number) => `<ListItem type="record"><Alignment type="enumeration">LeftAlign</Alignment>
  <AlignmentCharacter type="string">.</AlignmentCharacter><Leader type="string"></Leader><Position type="unit">${position}</Position></ListItem>`;
const run = (text: string, attributes = '') =>
  `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"${attributes}><Content>${text}</Content></CharacterStyleRange>`;
const paragraph = (style: string, body: string, local = '', properties = '') =>
  `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/${style}"${local}>${properties ? `<Properties>${properties}</Properties>` : ''}${body}<Br/></ParagraphStyleRange>`;
const lines = (text: string) => text.split('\n').map(line => `<Content>${line}</Content>`).join('<Br/>');

const body = 'Первый абзац основного текста набран кеглем двенадцать пунктов и выключен по формату, чтобы строки переносились несколько раз и было видно, где начинается первая строка.';
const second = 'Второй абзац продолжает текст, его первая строка тоже начинается с отступа, а остальные строки идут от края колонки.';

const stories: Record<string, string> = {
  'first-line': paragraph('Text', run(body)) + paragraph('Text', run(second)),
  hanging: paragraph('Footnote', run('1. Примечание длиной в несколько строк: номер выступает влево, а текст выровнен по левому отступу, как в сносках книги.')),
  'left-indent': paragraph('Эпиграф', run('Строка эпиграфа')) + paragraph('Text of stih', run('Строка стиха\nвторая строка стиха'.replace('\n', '&#x2028;'))),
  'right-indent': paragraph('Автор', run('Имя Фамилия автора, достаточно длинное, чтобы занять две строки')),
  spacing: paragraph('Text', run(body)) + paragraph('***', run('***')) + paragraph('Text', run(second)),
  // The imprint: a tab before each name, each line a separate paragraph line in 9 pt.
  tabs: paragraph('$ID/NormalParagraphStyle', `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]" PointSize="9">${
    lines('Редакторская группа:\tИмя Фамилия\n\tИмя Фамилия\n\tИмя Фамилия')}</CharacterStyleRange>`, '',
    `<TabList type="list">${tabStop(100)}${tabStop(110)}</TabList>`),
  // InDesign writes ":" in a style's Self, and in references to it, as %3a.
  contents: paragraph('Содержание%3aНазвание стиха в оглавлении', run('Название рассказа\t5')) +
    paragraph('Содержание%3aНазвание стиха в оглавлении', run('Другой рассказ с длинным названием\t127')),
  caps: paragraph('Рассказ', run('Название рассказа')) + paragraph('Master%3aLine UP', run('Название книги', ' Capitalization="AllCaps"')),
};

const PAGE_HEIGHT = 623.6220472440947, PAGE_WIDTH = 453.5433070866142;
// The books' text frames: 20 mm from the left page edge and 27 mm from the top, 120 x 166 mm.
const frame = (id: string) => `<TextFrame Self="${id}" ParentStory="${id}-story" AppliedObjectStyle="ObjectStyle/$ID/[Normal Text Frame]"
  ItemTransform="1 0 0 1 0 ${-PAGE_HEIGHT / 2}"><Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>
  <PathPointType Anchor="56.69 76.54" LeftDirection="56.69 76.54" RightDirection="56.69 76.54"/>
  <PathPointType Anchor="56.69 547.09" LeftDirection="56.69 547.09" RightDirection="56.69 547.09"/>
  <PathPointType Anchor="396.85 547.09" LeftDirection="396.85 547.09" RightDirection="396.85 547.09"/>
  <PathPointType Anchor="396.85 76.54" LeftDirection="396.85 76.54" RightDirection="396.85 76.54"/>
  </PathPointArray></GeometryPathType></PathGeometry></Properties><TextFramePreference InsetSpacing="0 0 0 0"/></TextFrame>`;

/** The cases as one IDML package, one right-hand page per case in the order of `stories`. */
export function inDesignLayoutCases(): Uint8Array {
  const ids = Object.keys(stories);
  const files: Record<string, string> = {
    'designmap.xml': `<Document>${ids.map(id => `<idPkg:Spread src="Spreads/Spread_${id}.xml"/>`).join('')}</Document>`,
    'Resources/Styles.xml': styles,
    'Resources/Preferences.xml': `<Preferences><DocumentPreference PageHeight="${PAGE_HEIGHT}" PageWidth="${PAGE_WIDTH}" FacingPages="true"/>
      <GridPreference BaselineStart="36" BaselineDivision="12" BaselineGridRelativeOption="TopOfPageOfBaselineGridRelativeOption"/></Preferences>`,
  };
  for (const id of ids) {
    files[`Spreads/Spread_${id}.xml`] = `<Spread Self="spread-${id}"><Page Self="page-${id}" GeometricBounds="0 0 ${PAGE_HEIGHT} ${PAGE_WIDTH}"
      ItemTransform="1 0 0 1 0 ${-PAGE_HEIGHT / 2}"/>${frame(id)}</Spread>`;
    files[`Stories/Story_${id}-story.xml`] = `<Story Self="${id}-story">${stories[id]}</Story>`;
  }
  return createZipArchive(files);
}
