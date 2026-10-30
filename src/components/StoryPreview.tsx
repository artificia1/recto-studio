import type { ProjectState, StoryContent, TextElement } from '../types';
import { resolveParagraphStyle, resolveRunStyle } from '../engine/storyLayout';

export function StoryPreview({ content, frame, state }: { content: StoryContent; frame: TextElement; state: ProjectState }) {
  return <div className="manuscript-preview" aria-label="Formatted manuscript preview">
    {content.paragraphs.slice(0, 150).map((paragraph, index) => {
      const style = resolveParagraphStyle(paragraph, state.paragraphStyles);
      return <p key={index} data-style={style?.name || 'Frame default'} style={{
        fontFamily: style?.fontFamily || frame.fontFamily,
        fontSize: `${Math.min(style?.fontSizePt || frame.fontSizePt, 30)}pt`,
        lineHeight: style?.lineHeight || frame.lineHeight, textAlign: style?.alignment || frame.alignment,
      }}>{paragraph.runs.map((run, ri) => {
        const format = resolveRunStyle(frame, style, run, state.characterStyles || []);
        return <span key={ri} style={{ fontFamily: format.fontFamily, fontWeight: format.bold ? 700 : 400,
          fontStyle: format.italic ? 'italic' : 'normal', textDecoration: format.underline ? 'underline' : 'none',
          color: format.color, whiteSpace: 'pre-wrap' }}>{run.text || '\u00a0'}</span>;
      })}</p>;
    })}
    {content.paragraphs.length > 150 && <p className="preview-limit">Preview shows the first 150 paragraphs. The complete manuscript will be placed.</p>}
  </div>;
}
