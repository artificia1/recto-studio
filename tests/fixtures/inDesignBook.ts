/**
 * A small InDesign book export, written the way InDesign writes IDML: built-in styles named with
 * $ID/, BasedOn without the type prefix, Auto leading, object styles, special characters as
 * processing instructions, and a facing spread whose two pages use different parents.
 */
import { createZipArchive } from '../../src/zip';

const styles = `<Styles>
  <RootParagraphStyleGroup>
    <ParagraphStyle Self="ParagraphStyle/$ID/[No paragraph style]" Name="$ID/[No paragraph style]" PointSize="12"
      Leading="Auto" AutoLeading="120" GridAlignment="None" FontStyle="Regular" Tracking="0">
      <Properties><AppliedFont type="string">Minion Pro</AppliedFont></Properties>
    </ParagraphStyle>
    <ParagraphStyle Self="ParagraphStyle/$ID/NormalParagraphStyle" Name="$ID/NormalParagraphStyle">
      <Properties><BasedOn type="string">$ID/[No paragraph style]</BasedOn><AppliedFont type="string">Arial</AppliedFont></Properties>
    </ParagraphStyle>
    <ParagraphStyle Self="ParagraphStyle/Text" Name="Text" AutoLeading="130" Justification="LeftJustified">
      <Properties><BasedOn type="string">$ID/[No paragraph style]</BasedOn><AppliedFont type="string">Arial</AppliedFont></Properties>
    </ParagraphStyle>
    <ParagraphStyle Self="ParagraphStyle/Story" Name="Рассказ" FontStyle="Bold" PointSize="18" Justification="CenterAlign" Tracking="50">
      <Properties><BasedOn type="string">$ID/[No paragraph style]</BasedOn><AppliedFont type="string">Arial</AppliedFont></Properties>
    </ParagraphStyle>
    <ParagraphStyle Self="ParagraphStyle/Subtitle" Name="Подзаголовок" FontStyle="Bold Italic" PointSize="13">
      <Properties><BasedOn type="string">ParagraphStyle/Story</BasedOn></Properties>
    </ParagraphStyle>
    <ParagraphStyle Self="ParagraphStyle/Epigraph source " Name="Эпиграф Подпись " FontStyle="Italic" PointSize="10">
      <Properties><BasedOn type="string">$ID/[No paragraph style]</BasedOn><AppliedFont type="string">Arial</AppliedFont></Properties>
    </ParagraphStyle>
    <ParagraphStyle Self="ParagraphStyle/Hebrew" Name="Text Hebrew" Justification="RightJustified">
      <Properties><BasedOn type="string">$ID/[No paragraph style]</BasedOn></Properties>
    </ParagraphStyle>
    <ParagraphStyle Self="ParagraphStyle/Gridded" Name="На сетке" GridAlignment="AlignBaseline" Leading="14">
      <Properties><BasedOn type="string">ParagraphStyle/Text</BasedOn></Properties>
    </ParagraphStyle>
  </RootParagraphStyleGroup>
  <RootObjectStyleGroup>
    <ObjectStyle Self="ObjectStyle/$ID/[None]" Name="$ID/[None]" FillColor="Swatch/None" StrokeWeight="0" StrokeColor="Swatch/None"/>
    <ObjectStyle Self="ObjectStyle/$ID/[Normal Graphics Frame]" Name="$ID/[Normal Graphics Frame]" StrokeWeight="1" StrokeColor="Color/Black">
      <Properties><BasedOn type="string">$ID/[None]</BasedOn></Properties>
    </ObjectStyle>
    <ObjectStyle Self="ObjectStyle/line" Name="line" StrokeWeight="2">
      <Properties><BasedOn type="string">ObjectStyle/$ID/[Normal Graphics Frame]</BasedOn></Properties>
    </ObjectStyle>
  </RootObjectStyleGroup>
</Styles>`;

const graphic = `<Graphic><Color Self="Color/Black" Model="Process" Space="CMYK" ColorValue="0 0 0 100" Name="Black"/></Graphic>`;
const preferences = `<Preferences><DocumentPreference PageHeight="623.62" PageWidth="453.54" FacingPages="true"/>
  <GridPreference BaselineStart="36" BaselineDivision="14" BaselineGridRelativeOption="TopOfPageOfBaselineGridRelativeOption"/></Preferences>`;
const page = (self: string, master: string, x: number) =>
  `<Page Self="${self}" AppliedMaster="${master}" GeometricBounds="0 0 623.62 453.54" ItemTransform="1 0 0 1 ${x} -311.81"/>`;
const frame = (self: string, story: string, x: number) =>
  `<TextFrame Self="${self}" ParentStory="${story}" AppliedObjectStyle="ObjectStyle/$ID/[Normal Text Frame]" ItemTransform="1 0 0 1 ${x} -311.81">
    <Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>
      <PathPointType Anchor="40 60" LeftDirection="40 60" RightDirection="40 60"/><PathPointType Anchor="40 560" LeftDirection="40 560" RightDirection="40 560"/>
      <PathPointType Anchor="400 560" LeftDirection="400 560" RightDirection="400 560"/><PathPointType Anchor="400 60" LeftDirection="400 60" RightDirection="400 60"/>
    </PathPointArray></GeometryPathType></PathGeometry></Properties></TextFrame>`;
const story = (self: string, ranges: string) => `<Story Self="${self}">${ranges}</Story>`;
const range = (style: string, text: string, local = '') =>
  `<ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/${style}"${local}><CharacterStyleRange><Content>${text}</Content><Br/></CharacterStyleRange></ParagraphStyleRange>`;

export interface InDesignBookOptions {
  /** Artwork on the left page of the "A" parent, which the spread's left page uses. */
  leftParentArtwork?: boolean;
}

export function inDesignBook({ leftParentArtwork = false }: InDesignBookOptions = {}) {
  return createZipArchive({
    'designmap.xml': '<Document><idPkg:Spread src="Spreads/Spread_one.xml"/></Document>',
    'Resources/Styles.xml': styles,
    'Resources/Graphic.xml': graphic,
    'Resources/Preferences.xml': preferences,
    'MasterSpreads/MasterSpread_empty.xml': `<MasterSpread Self="empty" NamePrefix="A" BaseName="Parent">
      ${page('ea', '', -453.54)}${page('eb', '', 0)}
      ${leftParentArtwork ? frame('mark', 'mark-story', -453.54) : ''}</MasterSpread>`,
    'Stories/Story_mark-story.xml': story('mark-story', range('Text', 'Parent A mark')),
    'MasterSpreads/MasterSpread_head.xml': `<MasterSpread Self="head" NamePrefix="B" BaseName="Running head">
      ${page('ha', '', -453.54)}${page('hb', '', 0)}
      <GraphicLine Self="rule-left" AppliedObjectStyle="ObjectStyle/line" ItemTransform="1 0 0 1 -453.54 -311.81">
        <Properties><PathGeometry><GeometryPathType PathOpen="true"><PathPointArray>
          <PathPointType Anchor="56 45" LeftDirection="56 45" RightDirection="56 45"/><PathPointType Anchor="396 45" LeftDirection="396 45" RightDirection="396 45"/>
        </PathPointArray></GeometryPathType></PathGeometry></Properties></GraphicLine>
      <GraphicLine Self="rule-right" AppliedObjectStyle="ObjectStyle/line" ItemTransform="1 0 0 1 0 -311.81">
        <Properties><PathGeometry><GeometryPathType PathOpen="true"><PathPointArray>
          <PathPointType Anchor="56 45" LeftDirection="56 45" RightDirection="56 45"/><PathPointType Anchor="396 45" LeftDirection="396 45" RightDirection="396 45"/>
        </PathPointArray></GeometryPathType></PathGeometry></Properties></GraphicLine>
      ${frame('folio', 'folio-story', 0)}</MasterSpread>`,
    'Stories/Story_folio-story.xml': story('folio-story', range('Text', 'Running head <?ACE 18?>')),
    'Spreads/Spread_one.xml': `<Spread Self="one">${page('left', 'empty', -453.54)}${page('right', 'head', 0)}
      ${frame('imprint', 'imprint-story', -453.54)}${frame('chapter', 'chapter-story', 0)}</Spread>`,
    // The series plate centres its text with a local override of [Basic Paragraph]'s alignment.
    'Stories/Story_imprint-story.xml': story('imprint-story', range('$ID/NormalParagraphStyle', 'Imprint') +
      range('$ID/NormalParagraphStyle', 'Series plate', ' SingleWordJustification="LeftAlign" Justification="CenterAlign"')),
    'Stories/Story_chapter-story.xml': story('chapter-story', range('Story', 'Налить кофе') + range('Epigraph source ', '(Исход, 21:24)') +
      range('Text', 'Кофе по-израильски')),
  });
}

