/**
 * Recto Studio — Adobe InDesign IDML Package Exporter (.idml)
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 *
 * Generates an Adobe InDesign Interchange (.idml) ZIP package conforming to
 * the IDML Packaging Specification (DOMVersion 8.0 / CS6 - 2026 InDesign round-trip).
 */

import { ProjectState, TextElement, ImageElement, ShapeElement } from '../types';
import { createZipArchive } from '../zip';

const MM_TO_PT = 72 / 25.4; // 1 mm = 2.83464567 pt

function escapeXml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function exportDocumentToIdml(state: ProjectState): Uint8Array {
  const files: Record<string, string | Uint8Array> = {};

  const pwPt = Math.round(state.settings.widthMm * MM_TO_PT * 100) / 100;
  const phPt = Math.round(state.settings.heightMm * MM_TO_PT * 100) / 100;
  const bleedPt = Math.round((state.settings.bleedMm || 3) * MM_TO_PT * 100) / 100;
  const topPt = Math.round((state.settings.margins.topMm || 20) * MM_TO_PT * 100) / 100;
  const btmPt = Math.round((state.settings.margins.bottomMm || 20) * MM_TO_PT * 100) / 100;
  const leftPt = Math.round((state.settings.margins.insideMm || 25) * MM_TO_PT * 100) / 100;
  const rightPt = Math.round((state.settings.margins.outsideMm || 18) * MM_TO_PT * 100) / 100;
  const facingPages = Boolean(state.settings.facingPages);

  // 1. mimetype (MUST be first, uncompressed)
  files['mimetype'] = 'application/vnd.adobe.indesign-idml-package';

  // 2. META-INF/container.xml
  files['META-INF/container.xml'] = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="designmap.xml" media-type="text/xml"/>
  </rootfiles>
</container>`;

  // 3. Resources/Preferences.xml
  files['Resources/Preferences.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Preferences xmlns:idPkg="http://schemas.adobe.com/idml/1.0/packaging" DOMVersion="8.0">
  <DocumentPreference
    PageWidth="${pwPt}"
    PageHeight="${phPt}"
    PagesPerSpread="${facingPages ? 2 : 1}"
    FacingPages="${facingPages ? 'true' : 'false'}"
    DocumentBleedTopOffset="${bleedPt}"
    DocumentBleedBottomOffset="${bleedPt}"
    DocumentBleedInsideOrLeftOffset="${bleedPt}"
    DocumentBleedOutsideOrRightOffset="${bleedPt}"
  />
  <MarginPreference
    Top="${topPt}"
    Bottom="${btmPt}"
    Left="${leftPt}"
    Right="${rightPt}"
    ColumnCount="${state.settings.columnCount || 1}"
    ColumnGutter="${Math.round((state.settings.columnGutterMm || 5) * MM_TO_PT * 100) / 100}"
  />
</idPkg:Preferences>`;

  // 4. Resources/Styles.xml
  const styleDefs = (state.paragraphStyles || []).map((style) => {
    let just = 'LeftAlign';
    if (style.alignment === 'center') just = 'CenterAlign';
    else if (style.alignment === 'right') just = 'RightAlign';
    else if (style.alignment === 'justify') just = 'LeftJustified';

    const fontName = (style.fontFamily || 'Inter').split(',')[0].trim().replace(/['"]/g, '');
    const ptSize = style.fontSizePt || 10;
    const leading = Math.round(ptSize * (style.lineHeight || 1.3) * 10) / 10;

    return `    <ParagraphStyle Self="ParagraphStyle/${escapeXml(style.name)}"
      Name="${escapeXml(style.name)}"
      PointSize="${ptSize}"
      Leading="${leading}"
      Justification="${just}"
      AppliedFont="${escapeXml(fontName)}"
      DropCapLines="${style.dropCapLines || 0}"
    />`;
  }).join('\n');

  files['Resources/Styles.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Styles xmlns:idPkg="http://schemas.adobe.com/idml/1.0/packaging" DOMVersion="8.0">
  <RootParagraphStyleGroup Self="RootParagraphStyleGroup">
    <ParagraphStyle Self="ParagraphStyle/$ID/NormalParagraphStyle" Name="$ID/NormalParagraphStyle" PointSize="10" />
${styleDefs}
  </RootParagraphStyleGroup>
</idPkg:Styles>`;

  // 5. Generate Stories & Spreads
  const spreadRefs: string[] = [];
  const storyRefs: string[] = [];
  let storyIndex = 1;

  state.spreads.forEach((spread, sIdx) => {
    const spreadId = `Spread_s${sIdx + 1}`;
    spreadRefs.push(`  <idPkg:Spread src="Spreads/${spreadId}.xml"/>`);

    const pageXmls: string[] = spread.pages.map((page, pIdx) => {
      const pageId = `Page_s${sIdx + 1}_p${pIdx + 1}`;
      const isLeft = page.side === 'left';
      const mLeft = isLeft ? rightPt : leftPt;
      const mRight = isLeft ? leftPt : rightPt;
      const pageXOffsetPt = Math.round((pIdx * state.settings.widthMm) * MM_TO_PT * 100) / 100;
      const pageBoundsStr = `0 ${pageXOffsetPt} ${phPt} ${Math.round((pageXOffsetPt + pwPt) * 100) / 100}`;

      return `      <Page Self="${pageId}" Name="${page.pageNumber}" AppliedTrapPreset="TrapPreset/$ID/kDefaultTrapPreset">
        <Properties>
          <PageColor>PageColor/$ID/White</PageColor>
          <GeometricBounds>${pageBoundsStr}</GeometricBounds>
          <MarginPreference Top="${topPt}" Bottom="${btmPt}" Left="${mLeft}" Right="${mRight}" ColumnCount="${state.settings.columnCount || 1}" />
        </Properties>
      </Page>`;
    });

    const elementXmls: string[] = [];

    for (const el of spread.elements) {
      const pageIdx = Math.max(0, spread.pages.findIndex(p => p.id === el.pageId));
      const spreadXMm = (pageIdx * state.settings.widthMm) + el.x;
      const y1Pt = Math.round(el.y * MM_TO_PT * 100) / 100;
      const x1Pt = Math.round(spreadXMm * MM_TO_PT * 100) / 100;
      const y2Pt = Math.round((el.y + el.height) * MM_TO_PT * 100) / 100;
      const x2Pt = Math.round((spreadXMm + el.width) * MM_TO_PT * 100) / 100;
      const boundsStr = `${y1Pt} ${x1Pt} ${y2Pt} ${x2Pt}`;

      if (el.type === 'text') {
        const textEl = el as TextElement;
        const storyId = `Story_u${storyIndex++}`;
        storyRefs.push(`  <idPkg:Story src="Stories/${storyId}.xml"/>`);

        // Create Story XML
        const appliedStyle = state.paragraphStyles?.find(s => s.id === textEl.paragraphStyleId);
        const styleName = appliedStyle ? appliedStyle.name : '$ID/NormalParagraphStyle';
        const cleanContent = escapeXml(textEl.text || '');

        files[`Stories/${storyId}.xml`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Story xmlns:idPkg="http://schemas.adobe.com/idml/1.0/packaging" DOMVersion="8.0">
  <Story Self="${storyId}" AppliedTOCStyle="n" TrackChanges="false" StoryTitle="${escapeXml(textEl.id)}">
    <ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/${escapeXml(styleName)}">
      <CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"
        PointSize="${textEl.fontSizePt || 10}"
        AppliedFont="${escapeXml((textEl.fontFamily || 'Inter').split(',')[0].trim().replace(/['"]/g, ''))}">
        <Content>${cleanContent}</Content>
      </CharacterStyleRange>
    </ParagraphStyleRange>
  </Story>
</idPkg:Story>`;

        const pathGeometry = `
          <PathGeometry>
            <GeometryPathType PathOpen="false">
              <PathPointArray>
                <PathPointType Anchor="${x1Pt} ${y1Pt}" LeftDirection="${x1Pt} ${y1Pt}" RightDirection="${x1Pt} ${y1Pt}" />
                <PathPointType Anchor="${x2Pt} ${y1Pt}" LeftDirection="${x2Pt} ${y1Pt}" RightDirection="${x2Pt} ${y1Pt}" />
                <PathPointType Anchor="${x2Pt} ${y2Pt}" LeftDirection="${x2Pt} ${y2Pt}" RightDirection="${x2Pt} ${y2Pt}" />
                <PathPointType Anchor="${x1Pt} ${y2Pt}" LeftDirection="${x1Pt} ${y2Pt}" RightDirection="${x1Pt} ${y2Pt}" />
              </PathPointArray>
            </GeometryPathType>
          </PathGeometry>`;

        elementXmls.push(`      <TextFrame Self="TextFrame_${el.id}" ParentStory="${storyId}" ContentType="TextType" ItemTransform="1 0 0 1 0 0" GeometricBounds="${boundsStr}">
        <Properties>
          <GeometricBounds>${boundsStr}</GeometricBounds>${pathGeometry}
        </Properties>
        <TextFramePreference TextColumnCount="${textEl.columns || 1}" TextColumnGutter="${Math.round((textEl.columnGutterMm || 4) * MM_TO_PT * 100) / 100}" />
      </TextFrame>`);
      } else if (el.type === 'image') {
        const imgEl = el as ImageElement;
        const pathGeometry = `
          <PathGeometry>
            <GeometryPathType PathOpen="false">
              <PathPointArray>
                <PathPointType Anchor="${x1Pt} ${y1Pt}" LeftDirection="${x1Pt} ${y1Pt}" RightDirection="${x1Pt} ${y1Pt}" />
                <PathPointType Anchor="${x2Pt} ${y1Pt}" LeftDirection="${x2Pt} ${y1Pt}" RightDirection="${x2Pt} ${y1Pt}" />
                <PathPointType Anchor="${x2Pt} ${y2Pt}" LeftDirection="${x2Pt} ${y2Pt}" RightDirection="${x2Pt} ${y2Pt}" />
                <PathPointType Anchor="${x1Pt} ${y2Pt}" LeftDirection="${x1Pt} ${y2Pt}" RightDirection="${x1Pt} ${y2Pt}" />
              </PathPointArray>
            </GeometryPathType>
          </PathGeometry>`;

        elementXmls.push(`      <Rectangle Self="Rectangle_${el.id}" ContentType="GraphicType" ItemTransform="1 0 0 1 0 0" GeometricBounds="${boundsStr}">
        <Properties>
          <GeometricBounds>${boundsStr}</GeometricBounds>${pathGeometry}
        </Properties>
        <Image Self="Image_${el.id}">
          <Properties>
            <Profile>Embedded</Profile>
          </Properties>
          <Link Self="Link_${el.id}" AssetURL="${escapeXml(imgEl.name || 'image.jpg')}" StoredState="Normal" />
        </Image>
      </Rectangle>`);
      } else if (el.type === 'shape') {
        const shape = el as ShapeElement;
        const pathGeometry = `
          <PathGeometry>
            <GeometryPathType PathOpen="false">
              <PathPointArray>
                <PathPointType Anchor="${x1Pt} ${y1Pt}" LeftDirection="${x1Pt} ${y1Pt}" RightDirection="${x1Pt} ${y1Pt}" />
                <PathPointType Anchor="${x2Pt} ${y1Pt}" LeftDirection="${x2Pt} ${y1Pt}" RightDirection="${x2Pt} ${y1Pt}" />
                <PathPointType Anchor="${x2Pt} ${y2Pt}" LeftDirection="${x2Pt} ${y2Pt}" RightDirection="${x2Pt} ${y2Pt}" />
                <PathPointType Anchor="${x1Pt} ${y2Pt}" LeftDirection="${x1Pt} ${y2Pt}" RightDirection="${x1Pt} ${y2Pt}" />
              </PathPointArray>
            </GeometryPathType>
          </PathGeometry>`;

        if (shape.shapeKind === 'ellipse') {
          elementXmls.push(`      <Oval Self="Oval_${el.id}" ContentType="Unassigned" ItemTransform="1 0 0 1 0 0" GeometricBounds="${boundsStr}">
        <Properties>
          <GeometricBounds>${boundsStr}</GeometricBounds>${pathGeometry}
        </Properties>
      </Oval>`);
        } else {
          elementXmls.push(`      <Rectangle Self="Rectangle_${el.id}" ContentType="Unassigned" ItemTransform="1 0 0 1 0 0" GeometricBounds="${boundsStr}">
        <Properties>
          <GeometricBounds>${boundsStr}</GeometricBounds>${pathGeometry}
        </Properties>
      </Rectangle>`);
        }
      }
    }

    files[`Spreads/${spreadId}.xml`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Spread xmlns:idPkg="http://schemas.adobe.com/idml/1.0/packaging" DOMVersion="8.0">
  <Spread Self="${spreadId}" PageCount="${spread.pages.length}">
${pageXmls.join('\n')}
${elementXmls.join('\n')}
  </Spread>
</idPkg:Spread>`;
  });

  // 6. designmap.xml
  files['designmap.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Document xmlns:idPkg="http://schemas.adobe.com/idml/1.0/packaging" DOMVersion="8.0" Self="d" StoryList="${storyRefs.map((_, i) => `Story_u${i + 1}`).join(' ')}">
  <Properties>
    <PageWidth>${pwPt}</PageWidth>
    <PageHeight>${phPt}</PageHeight>
    <PagesPerSpread>${facingPages ? 2 : 1}</PagesPerSpread>
    <FacingPages>${facingPages ? 'true' : 'false'}</FacingPages>
  </Properties>
  <idPkg:Preferences src="Resources/Preferences.xml"/>
  <idPkg:Styles src="Resources/Styles.xml"/>
${spreadRefs.join('\n')}
${storyRefs.join('\n')}
</Document>`;

  return createZipArchive(files);
}
