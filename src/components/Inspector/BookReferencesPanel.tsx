import { useMemo, useState } from 'preact/hooks';
import type { ArchivedChapter } from '../../engine/bookArchive';
import { bookReferenceKey, bookReferenceTargets, type BookReference } from '../../engine/bookReferences';

interface Props {
  chapters: ArchivedChapter[];
  references: BookReference[];
  onChange: (references: BookReference[]) => void;
  disabled: boolean;
}

export default function BookReferencesPanel({ chapters, references, onChange, disabled }: Props) {
  const [key, setKey] = useState('');
  const [chapterId, setChapterId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [format, setFormat] = useState<BookReference['format']>('page');
  const chapter = chapters.find(item => item.id === chapterId);
  const targets = useMemo(() => chapter ? bookReferenceTargets(chapter.state) : [], [chapter]);
  const idOf = (target: (typeof targets)[number]) => JSON.stringify([target.elementId, target.paragraphId]);
  const target = targets.find(item => idOf(item) === targetId);
  const resolvedFormat = format === 'caption' && !target?.caption ? 'page' : format === 'title' && target?.caption ? 'page' : format;
  const canSave = bookReferenceKey.test(key) && !!target && !disabled &&
    (references.length < 1000 || references.some(ref => ref.key === key));

  return <details>
    <summary>Book references</summary>
    <p>In a chapter story, type a marker such as <code>[[book:methods]]</code>. Assign its key here. The assembled book substitutes the target’s current page, heading, or caption number.</p>
    <label>Reference key<input value={key} maxLength={64} onInput={event => setKey(event.currentTarget.value)} placeholder="methods" disabled={disabled}/></label>
    <label>Target chapter<select value={chapterId} onChange={event => { setChapterId(event.currentTarget.value); setTargetId(''); }} disabled={disabled}>
      <option value="">Choose a chapter</option>
      {chapters.map(item => <option key={item.id} value={item.id}>{item.state.settings.title || item.name}</option>)}
    </select></label>
    <label>Target heading or caption<select value={targetId} onChange={event => setTargetId(event.currentTarget.value)} disabled={disabled || !targets.length}>
      <option value="">Choose a target</option>
      {targets.map((item, index) => <option key={idOf(item)} value={idOf(item)}>{index + 1}. {item.title}</option>)}
    </select></label>
    <label>Reference displays<select value={resolvedFormat} disabled={disabled} onChange={event => setFormat(event.currentTarget.value as BookReference['format'])}>
      <option value="page">Page number</option>
      {target && (target.caption ? <option value="caption">Caption number</option> : <option value="title">Heading text</option>)}
    </select></label>
    <button className="sm-btn" disabled={!canSave} onClick={() => {
      if (!target) return;
      const reference = { key, chapterId, elementId: target.elementId, paragraphId: target.paragraphId, format: resolvedFormat };
      onChange([...references.filter(item => item.key !== key), reference]);
      setKey('');
    }}>{references.some(ref => ref.key === key) ? 'Update reference target' : 'Add book reference'}</button>
    {references.length > 0 && <ul className="editorial-list">{references.map(ref => <li key={ref.key}>
      <code>{`[[book:${ref.key}]]`}</code> · {chapters.find(item => item.id === ref.chapterId)?.name || 'Missing chapter'}
      <button className="sm-btn" aria-label={`Remove reference ${ref.key}`} disabled={disabled} onClick={() => onChange(references.filter(item => item !== ref))}>Remove</button>
    </li>)}</ul>}
  </details>;
}
