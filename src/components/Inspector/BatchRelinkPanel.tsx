import { useRef, useState } from 'preact/hooks';
import { planImageRelinks, type ImageRelinkMatch } from '../../engine/imageRelinkPlan';
import { stateManager } from '../../state';

type Replacement = Parameters<typeof stateManager.relinkAssets>[0][number];
interface Review {
  revision: number;
  rows: ImageRelinkMatch<File>[];
  replacements: Replacement[];
}

export default function BatchRelinkPanel() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [review, setReview] = useState<Review>();
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const stale = review && review.revision !== stateManager.getDocumentRevision();

  async function prepare(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length) return;
    const revision = stateManager.getDocumentRevision();
    setReview(undefined);
    setMessage('Reading replacements…');
    setLoading(true);
    try {
      const rows = planImageRelinks(stateManager.getState(), files);
      const replacements: Replacement[] = [];
      if (rows.some(row => row.targetIds.length)) {
        const { readPlacedImage } = await import('../../engine/placedImage');
        for (const row of rows) {
          if (revision !== stateManager.getDocumentRevision()) throw new Error('The document changed. Select the replacements again.');
          if (!row.targetIds.length) continue;
          try {
            const { src, originalWidth, originalHeight, ...metadata } = await readPlacedImage(row.file);
            for (const elementId of row.targetIds) {
              replacements.push({ elementId, src, metadata: { ...metadata, width: originalWidth, height: originalHeight } });
            }
          } catch (error) {
            row.problem = error instanceof Error ? error.message : String(error);
          }
        }
      }
      if (revision !== stateManager.getDocumentRevision()) throw new Error('The document changed. Select the replacements again.');
      setReview({ revision, rows, replacements });
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  function apply() {
    if (!review) return;
    try {
      const count = stateManager.relinkAssets(review.replacements, review.revision);
      setMessage(count ? `Relinked ${count} image ${count === 1 ? 'frame' : 'frames'}.` : 'The matching frames changed. Select the replacements again.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
    setReview(undefined);
  }

  return <div className="batch-relink">
    <button type="button" className="sm-btn" disabled={loading} onClick={() => fileInput.current?.click()}>
      Bulk relink images…
    </button>
    <input type="file" ref={fileInput} aria-label="Bulk relink files" accept="image/*" multiple hidden disabled={loading} onChange={prepare} />
    {message && <p role="status">{message}</p>}
    {review && <section className="batch-relink-review" aria-label="Bulk relink review">
      <h4>Review replacements</h4>
      <ul>{review.rows.map((row, index) => <li key={index}>
        <strong>{row.file.name}</strong>
        <span>{row.problem || `${row.targetIds.length} ${row.targetIds.length === 1 ? 'frame' : 'frames'} ready${row.pages.length ? ` · Pages ${row.pages.join(', ')}` : ''}`}</span>
        {!!row.locked && !row.problem && <span>{row.locked} locked {row.locked === 1 ? 'frame' : 'frames'} skipped</span>}
      </li>)}</ul>
      {stale && <p role="status">The document changed. Select the replacements again.</p>}
      <div className="batch-relink-actions">
        <button type="button" className="sm-btn" disabled={stale || !review.replacements.length} onClick={apply}>
          {review.replacements.length ? `Apply ${review.replacements.length} replacements` : 'Apply replacements'}
        </button>
        <button type="button" className="sm-btn" onClick={() => setReview(undefined)}>Cancel bulk relink</button>
      </div>
    </section>}
  </div>;
}
