/**
 * Recto Studio — Adobe InDesign IDML Package Exporter (.idml)
 * Copyright (c) 2022-2026 Abhinav. All rights reserved.
 * Licensed under the MIT License.
 *
 * Generates an Adobe InDesign Interchange (.idml) ZIP package for supported objects.
 */

import { ProjectState, TextElement, ImageElement, ShapeElement } from '../types';
import { createZipArchive, base64ToUint8Array, uint8ArrayToBase64 } from '../zip';
import { assetStore } from '../engine/assetStore';
import { contentOf } from '../engine/publicationReferences';
import { resolveParagraphStyle, resolveRunStyle } from '../engine/storyLayout';
import { explicitCmyk, rgbColor } from '../engine/inkColors';
import { gradientCoordinates } from '../engine/fillGradients';
import type { FillGradient } from '../types';
import { shapeToPath } from '../engine/vectorPath';

const MM_TO_PT = 72 / 25.4; // 1 mm = 2.83464567 pt
const IDML_NS = 'http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging';
const normalStyle = 'ParagraphStyle/$ID/NormalParagraphStyle';

function escapeXml(str: string): string {
  if (!str) return '';
  return str.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function exportDocumentToIdml(state: ProjectState): Uint8Array {
  const files: Record<string, string | Uint8Array> = {};
  const swatches = new Map<string, string>();
  const gradients = new Map<string, string>();
  const swatch = (color?: string) => {
    if (!color || color === 'transparent' || color === 'none') return 'Swatch/None';
    const cmyk = explicitCmyk(color);
    const channels = cmyk || rgbColor(color);
    if (!channels) return 'Color/Black';
    const space = cmyk ? 'CMYK' : 'RGB';
    const key = `${space} ${channels.join(' ')}`;
    const name = `Recto ${key}`;
    const id = `Color/${name}`;
    if (!swatches.has(id)) swatches.set(id, `<Color Self="${id}" Name="${name}" Model="Process" Space="${space}" ColorValue="${channels.join(' ')}"/>`);
    return id;
  };
  const paintFill = (fill: string, gradient: FillGradient | undefined, x: number, y: number, width: number, height: number) => {
    if (!gradient) return `FillColor="${swatch(fill)}"`;
    const type = gradient.kind === 'linear' ? 'Linear' : 'Radial';
    const stops = gradient.stops.map(stop => ({ location: stop.offset * 100, color: swatch(stop.color) }));
    const key = JSON.stringify([type, stops]);
    let id = gradients.get(key);
    if (!id) {
      id = 'Gradient/RectoGradient' + (gradients.size + 1);
      gradients.set(key, id);
    }
    const { x1, y1, x2, y2, radius } = gradientCoordinates(gradient, x, y, width, height);
    const angle = Math.atan2(y1 - y2, x2 - x1) * 180 / Math.PI;
    return `FillColor="${id}" GradientFillStart="${x1} ${y1}" GradientFillLength="${radius}" GradientFillAngle="${angle}"`;
  };
  const styleIds = new Map(state.paragraphStyles.map((style, index) => [style.id, `ParagraphStyle/RectoStyle${index + 1}`]));
  const parents = new Map(state.masterSpreads.map((master, index) => [master.id, `MasterSpread_m${index + 1}`]));
  const sections = [...state.masterSpreads.map(master => ({ ...master, kind: 'MasterSpread' as const })),
    ...state.spreads.map(spread => ({ ...spread, kind: 'Spread' as const }))];
  const frames = new Map<string, TextElement>();
  const frameRefs = new Map<string, string>();
  for (const section of sections) for (const element of section.elements) {
    if (element.type !== 'text' || element.pasteboard || element.editorialOnly) continue;
    frames.set(element.id, element);
    frameRefs.set(element.id, `TextFrame_u${frameRefs.size + 1}`);
  }
  const storyIds = new Map<string, string>();
  for (const frame of frames.values()) {
    if (storyIds.has(frame.id)) continue;
    let head = frame;
    const visited = new Set<string>();
    while (head.prevFrameId && frames.has(head.prevFrameId)) {
      if (visited.has(head.id)) throw new Error('Repair the circular text thread before exporting IDML.');
      visited.add(head.id);
      head = frames.get(head.prevFrameId)!;
    }
    if (!storyIds.has(head.id)) {
      const id = `Story_u${frameRefs.get(head.id)!.slice('TextFrame_u'.length)}`;
      const content = contentOf(head);
      const paragraphs = content.paragraphs.map((paragraph, paragraphIndex) => {
        const style = resolveParagraphStyle(paragraph, state.paragraphStyles);
        const runs = paragraph.runs.map((run, runIndex) => {
          const format = resolveRunStyle(head, style, run, state.characterStyles || []);
          const fontStyle = format.bold ? format.italic ? 'Bold Italic' : 'Bold' : format.italic ? 'Italic' : 'Regular';
          const separator = runIndex === paragraph.runs.length - 1 && paragraphIndex < content.paragraphs.length - 1 ? '<Br/>' : '';
          const copy = run.text.split('\n').map(text => `<Content>${escapeXml(text)}</Content>`).join('<Br/>') + separator;
          return `<CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]" PointSize="${format.fontSizePt}" FontStyle="${fontStyle}" Underline="${!!format.underline}" FillColor="${swatch(format.color)}"><Properties><AppliedFont type="string">${escapeXml(format.fontFamily.split(',')[0].trim())}</AppliedFont></Properties>${copy}</CharacterStyleRange>`;
        });
        return `<ParagraphStyleRange AppliedParagraphStyle="${styleIds.get(paragraph.styleId || '') || normalStyle}">${runs.join('')}</ParagraphStyleRange>`;
      });
      files[`Stories/${id}.xml`] = `<?xml version="1.0" encoding="UTF-8"?>\n<idPkg:Story xmlns:idPkg="${IDML_NS}" DOMVersion="8.0"><Story Self="${id}">${paragraphs.join('\n')}</Story></idPkg:Story>`;
      storyIds.set(head.id, id);
    }
    storyIds.set(frame.id, storyIds.get(head.id)!);
  }

  const pwPt = Math.round(state.settings.widthMm * MM_TO_PT * 100) / 100;
  const phPt = Math.round(state.settings.heightMm * MM_TO_PT * 100) / 100;
  const bleedPt = Math.round((state.settings.bleedMm ?? 3) * MM_TO_PT * 100) / 100;
  const topPt = Math.round((state.settings.margins.topMm ?? 20) * MM_TO_PT * 100) / 100;
  const btmPt = Math.round((state.settings.margins.bottomMm ?? 20) * MM_TO_PT * 100) / 100;
  const leftPt = Math.round((state.settings.margins.insideMm ?? 25) * MM_TO_PT * 100) / 100;
  const rightPt = Math.round((state.settings.margins.outsideMm ?? 18) * MM_TO_PT * 100) / 100;
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
<idPkg:Preferences xmlns:idPkg="${IDML_NS}" DOMVersion="8.0">
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

    return `    <ParagraphStyle Self="${styleIds.get(style.id)}"
      Name="${escapeXml(style.name)}"
      PointSize="${ptSize}"
      Leading="${leading}"
      Justification="${just}"
      FillColor="${swatch(style.color)}"
      DropCapLines="${style.dropCapLines || 0}"
    ><Properties><AppliedFont type="string">${escapeXml(fontName)}</AppliedFont></Properties></ParagraphStyle>`;
  }).join('\n');

  files['Resources/Styles.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:Styles xmlns:idPkg="${IDML_NS}" DOMVersion="8.0">
  <RootParagraphStyleGroup Self="RootParagraphStyleGroup">
    <ParagraphStyle Self="ParagraphStyle/$ID/NormalParagraphStyle" Name="$ID/NormalParagraphStyle" PointSize="10" />
${styleDefs}
  </RootParagraphStyleGroup>
  <RootCharacterStyleGroup Self="RootCharacterStyleGroup"><CharacterStyle Self="CharacterStyle/$ID/[No character style]" Name="$ID/[No character style]"/></RootCharacterStyleGroup>
</idPkg:Styles>`;

  // 5. Generate Stories & Spreads
  const spreadRefs: string[] = [];
  const stories = [...new Set(storyIds.values())];
  const storyRefs = stories.map(id => `  <idPkg:Story src="Stories/${id}.xml"/>`);

  sections.forEach((spread, sIdx) => {
    const spreadId = spread.kind === 'MasterSpread' ? parents.get(spread.id)! : `Spread_s${sIdx + 1}`;
    const folder = spread.kind === 'MasterSpread' ? 'MasterSpreads' : 'Spreads';
    const appliedMaster = parents.get((spread.kind === 'MasterSpread' ? spread.parentMasterId : spread.masterSpreadId) || '') || 'n';
    spreadRefs.push(`  <idPkg:${spread.kind} src="${folder}/${spreadId}.xml"/>`);

    const pageXmls: string[] = spread.pages.map((page, pIdx) => {
      const pageId = `Page_s${sIdx + 1}_p${pIdx + 1}`;
      const isLeft = page.side === 'left';
      const mLeft = isLeft ? rightPt : leftPt;
      const mRight = isLeft ? leftPt : rightPt;
      const pageXOffsetPt = Math.round((pIdx * state.settings.widthMm) * MM_TO_PT * 100) / 100;
      const pageBoundsStr = `0 ${pageXOffsetPt} ${phPt} ${Math.round((pageXOffsetPt + pwPt) * 100) / 100}`;

      return `      <Page Self="${pageId}" Name="${page.pageNumber}" AppliedMaster="${appliedMaster}" GeometricBounds="${pageBoundsStr}" ItemTransform="1 0 0 1 0 0">
        <MarginPreference Top="${topPt}" Bottom="${btmPt}" Left="${mLeft}" Right="${mRight}" ColumnCount="${state.settings.columnCount || 1}" />
      </Page>`;
    });

    const elementXmls: string[] = [];

    for (const el of [...spread.elements].sort((a, b) => a.zIndex - b.zIndex)) {
      if (el.pasteboard || el.editorialOnly) continue;
      const pageIdx = Math.max(0, spread.pages.findIndex(p => p.id === el.pageId));
      const spreadXMm = (pageIdx * state.settings.widthMm) + el.x;
      const y1Pt = Math.round(el.y * MM_TO_PT * 100) / 100;
      const x1Pt = Math.round(spreadXMm * MM_TO_PT * 100) / 100;
      const y2Pt = Math.round((el.y + el.height) * MM_TO_PT * 100) / 100;
      const x2Pt = Math.round((spreadXMm + el.width) * MM_TO_PT * 100) / 100;
      const boundsStr = `${y1Pt} ${x1Pt} ${y2Pt} ${x2Pt}`;

      if (el.type === 'text') {
        const textEl = el as TextElement;
        const storyId = storyIds.get(el.id);
        const previous = frameRefs.get(textEl.prevFrameId || '') || 'n';
        const next = frameRefs.get(textEl.nextFrameId || '') || 'n';

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

        elementXmls.push(`      <TextFrame Self="${frameRefs.get(el.id)}" ParentStory="${storyId}" PreviousTextFrame="${previous}" NextTextFrame="${next}" ItemLayer="RectoLayer" FillColor="${swatch(el.backgroundColor)}" StrokeColor="${swatch(el.borderColor)}" StrokeWeight="${el.borderWidthMm * MM_TO_PT}" ContentType="TextType" ItemTransform="1 0 0 1 0 0" GeometricBounds="${boundsStr}">
        <Properties>
          <GeometricBounds>${boundsStr}</GeometricBounds>${pathGeometry}
        </Properties>
        <TextFramePreference TextColumnCount="${textEl.columns || 1}" TextColumnGutter="${Math.round((textEl.columnGutterMm || 4) * MM_TO_PT * 100) / 100}" />
      </TextFrame>`);
      } else if (el.type === 'image') {
        const imgEl = el as ImageElement;
        const fullResSrc: unknown = assetStore.getFullResolution(imgEl.assetId || imgEl.src) || imgEl.src;
        let b64Data = '';
        let fileName = `${sIdx + 1}-${elementXmls.length + 1}-${(imgEl.name || 'image').replace(/[^a-zA-Z0-9._-]/g, '-')}`;

        if (fullResSrc) {
          if (typeof fullResSrc === 'string' && fullResSrc.startsWith('data:')) {
            const parts = fullResSrc.split(',');
            b64Data = parts[1] || '';
            const mime = parts[0].split(';')[0].split(':')[1] || 'image/jpeg';
            const ext = mime === 'image/png' ? '.png' : mime === 'image/svg+xml' ? '.svg' : mime === 'image/webp' ? '.webp' : '.jpg';
            if (!fileName.includes('.')) fileName += ext;
            if (b64Data) {
              try {
                files[`Links/${fileName}`] = base64ToUint8Array(b64Data);
              } catch {
                // Ignore base64 decode failure
              }
            }
          } else if (fullResSrc instanceof ArrayBuffer) {
            files[`Links/${fileName}`] = new Uint8Array(fullResSrc);
            try {
              b64Data = uint8ArrayToBase64(new Uint8Array(fullResSrc));
            } catch {
              // Ignore
            }
          }
        }

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

        elementXmls.push(`      <Rectangle Self="Rectangle_${escapeXml(el.id)}" ItemLayer="RectoLayer" ContentType="GraphicType" ItemTransform="1 0 0 1 0 0" GeometricBounds="${boundsStr}">
        <Properties>
          <GeometricBounds>${boundsStr}</GeometricBounds>${pathGeometry}
        </Properties>
        <Image Self="Image_${escapeXml(el.id)}">
          <Properties>
            <Profile>Embedded</Profile>${b64Data ? `\n            <Contents>${b64Data}</Contents>` : ''}
          </Properties>
          <Link Self="Link_${escapeXml(el.id)}" AssetURL="${escapeXml(fileName)}" StoredState="${b64Data ? 'Embedded' : 'Normal'}" />
        </Image>
      </Rectangle>`);
      } else if (el.type === 'path' || (el.type === 'shape' && el.shapeKind === 'line')) {
        const path = el.type === 'path' ? el : shapeToPath(el);
        if (path.nodes.length < 2) continue;
        const type = path.closed ? 'Polygon' : 'GraphicLine';
        const radians = path.rotation * Math.PI / 180;
        const cos = Math.cos(radians), sin = Math.sin(radians), cx = (x1Pt + x2Pt) / 2, cy = (y1Pt + y2Pt) / 2;
        const matrix = [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy].join(' ');
        const point = (x: number, y: number) => `${x1Pt + x * MM_TO_PT} ${y1Pt + y * MM_TO_PT}`;
        const nodes = path.nodes.map(node => `<PathPointType Anchor="${point(node.x, node.y)}" LeftDirection="${point(node.x + (node.handleIn?.x || 0), node.y + (node.handleIn?.y || 0))}" RightDirection="${point(node.x + (node.handleOut?.x || 0), node.y + (node.handleOut?.y || 0))}"/>`).join('');
        const fill = paintFill(path.closed ? path.fillColor : 'transparent', path.closed ? path.fillGradient : undefined, x1Pt, y1Pt, el.width * MM_TO_PT, el.height * MM_TO_PT);
        elementXmls.push(`<${type} Self="${type}_${escapeXml(el.id)}" ItemLayer="RectoLayer" ${fill} StrokeColor="${swatch(path.strokeColor)}" StrokeWeight="${path.strokeWidthMm * MM_TO_PT}" ContentType="Unassigned" ItemTransform="${matrix}">
          <Properties><PathGeometry><GeometryPathType PathOpen="${!path.closed}"><PathPointArray>${nodes}</PathPointArray></GeometryPathType></PathGeometry></Properties></${type}>`);
      } else if (el.type === 'shape') {
        const shape = el as ShapeElement;
        const fill = paintFill(shape.fillColor, shape.shapeKind !== 'line' && !shape.spotColor ? shape.fillGradient : undefined, x1Pt, y1Pt, el.width * MM_TO_PT, el.height * MM_TO_PT);
        const paint = `ItemLayer="RectoLayer" ${fill} StrokeColor="${swatch(shape.strokeColor)}" StrokeWeight="${shape.strokeWidthMm * MM_TO_PT}"`;
        const pathGeometry = shape.shapeKind === 'ellipse' ? `<PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>${shapeToPath(shape).nodes.map(node => {
          const point = (x: number, y: number) => `${x1Pt + x * MM_TO_PT} ${y1Pt + y * MM_TO_PT}`;
          return `<PathPointType Anchor="${point(node.x, node.y)}" LeftDirection="${point(node.x + node.handleIn!.x, node.y + node.handleIn!.y)}" RightDirection="${point(node.x + node.handleOut!.x, node.y + node.handleOut!.y)}"/>`;
        }).join('')}</PathPointArray></GeometryPathType></PathGeometry>` : `
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
          elementXmls.push(`      <Oval Self="Oval_${escapeXml(el.id)}" ${paint} ContentType="Unassigned" ItemTransform="1 0 0 1 0 0" GeometricBounds="${boundsStr}">
        <Properties>
          <GeometricBounds>${boundsStr}</GeometricBounds>${pathGeometry}
        </Properties>
      </Oval>`);
        } else {
          elementXmls.push(`      <Rectangle Self="Rectangle_${escapeXml(el.id)}" ${paint} ContentType="Unassigned" ItemTransform="1 0 0 1 0 0" GeometricBounds="${boundsStr}">
        <Properties>
          <GeometricBounds>${boundsStr}</GeometricBounds>${pathGeometry}
        </Properties>
      </Rectangle>`);
        }
      }
    }

    const masterName = spread.kind === 'MasterSpread' ? ` Name="${escapeXml(`${spread.prefix}-${spread.name}`)}" NamePrefix="${escapeXml(spread.prefix)}" BaseName="${escapeXml(spread.name)}"` : '';
    files[`${folder}/${spreadId}.xml`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<idPkg:${spread.kind} xmlns:idPkg="${IDML_NS}" DOMVersion="8.0">
  <${spread.kind} Self="${spreadId}" AppliedMaster="${appliedMaster}" PageCount="${spread.pages.length}"${masterName}>
${pageXmls.join('\n')}
${elementXmls.join('\n')}
  </${spread.kind}>
</idPkg:${spread.kind}>`;
  });
  const gradientXml = [...gradients].map(([key, id]) => {
    const [type, stops] = JSON.parse(key) as ['Linear' | 'Radial', { location: number; color: string }[]];
    return `<Gradient Self="${id}" Name="${id.split('/')[1]}" Type="${type}">${stops.map((stop, index) =>
      `<GradientStop Self="${id}/stop${index}" StopColor="${stop.color}" Location="${stop.location}" Midpoint="50"/>`).join('')}</Gradient>`;
  });
  files['Resources/Graphic.xml'] = `<?xml version="1.0" encoding="UTF-8"?>\n<idPkg:Graphic xmlns:idPkg="${IDML_NS}" DOMVersion="8.0">${[...swatches.values(), ...gradientXml].join('\n')}</idPkg:Graphic>`;

  // 6. designmap.xml
  files['designmap.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<?aid style="50" type="document" readerVersion="6.0" featureSet="257"?>
<Document xmlns:idPkg="${IDML_NS}" DOMVersion="8.0" Self="d" StoryList="${stories.join(' ')}" ActiveLayer="RectoLayer">
  <Properties>
    <PageWidth>${pwPt}</PageWidth>
    <PageHeight>${phPt}</PageHeight>
    <PagesPerSpread>${facingPages ? 2 : 1}</PagesPerSpread>
    <FacingPages>${facingPages ? 'true' : 'false'}</FacingPages>
  </Properties>
  <idPkg:Preferences src="Resources/Preferences.xml"/>
  <idPkg:Styles src="Resources/Styles.xml"/>
  <idPkg:Graphic src="Resources/Graphic.xml"/>
  <Layer Self="RectoLayer" Name="Artwork" Visible="true" Locked="false" Printable="true"/>
${spreadRefs.join('\n')}
${storyRefs.join('\n')}
</Document>`;

  return createZipArchive(files);
}
