import { useMemo, useRef, useState } from 'preact/hooks';
import { stateManager } from '../state';
import type { ProjectState } from '../types';
import { savePublicationFile } from '../desktop';
import { useModalFocus } from '../hooks/useModalFocus';
import { MAX_XLIFF_BYTES, translationCatalog } from '../translation/catalog';
import { readTranslationExchange, writeTranslationExchange } from '../translation/xliff';
import type { ReturnedTranslation } from '../translation/xliff';
import { outstandingTranslationGroups, reviewTranslation, reviewedTargets, updateReviewedTranslation, type TranslationReview } from '../translation/review';
import { translationReviewHtml } from '../translation/report';
import { formatTranslationGlossary, parseTranslationGlossary, translationQualityFindings } from '../translation/quality';
import { previewTranslatedEdition } from '../translation/edition';
import { TranslationScope } from './TranslationScope';
import { TranslationReviewList } from './TranslationReviewList';
import { TranslationProof } from './TranslationProof';
import { TranslationMemoryPanel } from './TranslationMemoryPanel';
import { combineTranslationMemories, rememberReviewedTranslations, type TranslationMemory } from '../translation/memory';
import './manuscript.css';
import './translationWorkspace.css';

const fileBase = (value: string) => value.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 85) || 'publication';
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export default function TranslationWorkspace({ state, onClose }: { state: ProjectState; onClose: () => void }) {
  const dialog = useRef<HTMLElement>(null);
  useModalFocus(true, dialog);
  const revision = stateManager.getDocumentRevision();
  const session = stateManager.getDocumentSession();
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'export' | 'review'>('export');
  const [targetLanguage, setTargetLanguage] = useState('');
  const [scope, setScope] = useState(new Set<string>());
  const [includeRestricted, setIncludeRestricted] = useState(false);
  const [selected, setSelected] = useState(new Set<string>());
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [review, setReview] = useState<{ revision: number; value: TranslationReview; filename: string }>();
  const [glossary, setGlossary] = useState('');
  const [checkNumbers, setCheckNumbers] = useState(true);
  const [quality, setQuality] = useState<ReturnType<typeof translationQualityFindings>>();
  const [proof, setProof] = useState<ReturnType<typeof previewTranslatedEdition>>();
  const [memory, setMemory] = useState<TranslationMemory>();
  const catalog = useMemo(() => {
    try { return { groups: translationCatalog(stateManager.getState()), error: '' }; }
    catch (reason) { return { groups: [], error: errorText(reason) }; }
  }, [revision, session]);
  const sourceLanguage = state.settings.language || 'en';
  const activeReview = review?.revision === revision ? review.value : undefined;
  const allUnits = useMemo(() => catalog.groups.reduce((total, group) => total + group.units.length, 0), [catalog]);
  const visibleGroups = useMemo(() => catalog.groups.filter(group => includeRestricted || !group.restricted), [catalog, includeRestricted]);
  const selectedGroups = useMemo(() => visibleGroups.filter(group => scope.has(group.id)), [visibleGroups, scope]);
  const base = fileBase(state.settings.title || 'publication');
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setMessage('');
    try { await action(); }
    catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  };
  const ensureCurrent = () => {
    if (stateManager.getDocumentRevision() !== revision || stateManager.getDocumentSession() !== session) {
      throw new Error('The publication changed. Load the translation file again.');
    }
  };
  const locate = (id: string) => {
    if (stateManager.zoomToElement(id)) setMessage('Source frame selected on the canvas.');
  };
  const updateSelection = (next: Set<string>) => {
    setSelected(next);
    setProof(undefined);
  };
  const beginReview = (exchange: ReturnedTranslation, filename: string) => {
    ensureCurrent();
    const value = reviewTranslation(stateManager.getState(), catalog.groups, exchange);
    setReview({ revision, filename, value });
    setQuality(undefined);
    updateSelection(new Set());
    setView('review');
    setMessage('Translation loaded. Review the returned units before building an edition.');
  };

  return <div className="manuscript-overlay" onClick={() => { if (!busy) onClose(); }} onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape' && !busy) onClose();
  }}>
    <section ref={dialog} className="manuscript-dialog translation-workspace" role="dialog" aria-modal="true"
      aria-label="Translation workspace" onClick={event => event.stopPropagation()} aria-busy={busy}>
      <header className="manuscript-header">
        <h2>Translation workspace</h2>
        <button className="sm-btn" onClick={onClose} disabled={busy}>Close</button>
      </header>
      <div className="translation-toolbar publication-actions" role="group" aria-label="Translation workflow">
        <button className="sm-btn" aria-pressed={view === 'export'} disabled={busy} onClick={() => setView('export')}>Prepare XLIFF</button>
        <button className="sm-btn" aria-pressed={view === 'review'} disabled={busy} onClick={() => setView('review')}>Review returned translations</button>
      </div>
      <div className="translation-content publication-panel">
        {catalog.error && <p role="alert">{catalog.error}</p>}
        {view === 'export' && <>
          <p>Source language <strong>{sourceLanguage}</strong>. Select what you want to send to your translator.</p>
          <label>Target language tag<input maxLength={64} placeholder="fr-CA" value={targetLanguage}
            onInput={event => setTargetLanguage(event.currentTarget.value)} disabled={busy}/></label>
          {visibleGroups.length !== catalog.groups.length || includeRestricted ? <label className="publication-check">
            <input type="checkbox" checked={includeRestricted} disabled={busy} onChange={event => {
              const include = event.currentTarget.checked;
              setIncludeRestricted(include);
              if (!include) setScope(new Set(catalog.groups.filter(group => !group.restricted && scope.has(group.id)).map(group => group.id)));
            }}/>Include hidden layers, inactive editions and unused parent pages
          </label> : null}
          <TranslationScope groups={visibleGroups} selected={scope} onChange={setScope}/>
          <button className="action-btn" disabled={busy || !selectedGroups.length || !targetLanguage.trim()} onClick={() => void run(async () => {
            ensureCurrent();
            const exchange = writeTranslationExchange(selectedGroups, sourceLanguage, targetLanguage);
            if (await savePublicationFile(`${base}-translation.xlf`, exchange, 'application/xliff+xml')) setMessage('Translation exchange saved.');
          })}>Download XLIFF</button>
          <TranslationMemoryPanel memory={memory} groups={selectedGroups} sourceLanguage={sourceLanguage} disabled={busy}
            onChange={setMemory} onReview={exchange => void run(async () => beginReview(exchange, 'Translation memory'))}/>
        </>}
        {view === 'review' && <>
          <label>Returned XLIFF file<input type="file" accept=".xlf,.xliff,application/xliff+xml,application/xml"
            disabled={busy || !!catalog.error} onChange={event => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (!file) return;
              setReview(undefined);
              setQuality(undefined);
              updateSelection(new Set());
              void run(async () => {
                if (file.size > MAX_XLIFF_BYTES) throw new Error('Choose an XLIFF smaller than 16 MiB.');
                beginReview(readTranslationExchange(await file.text()), file.name);
              });
            }}/></label>
          {review && !activeReview && <p role="alert">The publication changed. Load the translation file again to refresh the review.</p>}
          {activeReview && <>
            <p><strong>{review?.filename}</strong> · {activeReview.sourceLanguage} → {activeReview.targetLanguage}</p>
            <details className="translation-quality">
              <summary>Terminology and numeric checks</summary>
              <label>Preferred translations<textarea value={glossary} maxLength={24000}
                placeholder="chapter → chapitre" onInput={event => {
                  setGlossary(event.currentTarget.value);
                  setQuality(undefined);
                }}/></label>
              <p>Enter one source term and preferred translation per line, separated by → or a tab.</p>
              <label>Open glossary<input type="file" accept=".tsv,.txt,text/plain,text/tab-separated-values" disabled={busy}
                onChange={event => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (!file) return;
                  void run(async () => {
                    if (file.size > 96 * 1024) throw new Error('Choose a glossary smaller than 96 KiB.');
                    const content = await file.text();
                    ensureCurrent();
                    setGlossary(formatTranslationGlossary(parseTranslationGlossary(content.replace(/^\uFEFF/, ''))));
                    setQuality(undefined);
                    setMessage('Glossary loaded.');
                  });
                }}/></label>
              <button className="sm-btn" disabled={busy || !glossary.trim()} onClick={() => void run(async () => {
                const terms = parseTranslationGlossary(glossary);
                if (!terms.length) throw new Error('Add a glossary term before saving.');
                if (await savePublicationFile(`${base}-${activeReview.targetLanguage}-glossary.txt`,
                  formatTranslationGlossary(terms), 'text/plain;charset=utf-8')) setMessage('Glossary saved.');
              })}>Save glossary</button>
              <label className="publication-check"><input type="checkbox" checked={checkNumbers} onChange={event => {
                setCheckNumbers(event.currentTarget.checked);
                setQuality(undefined);
              }}/>Compare numeric values using the source and target language conventions</label>
              <button className="sm-btn" disabled={busy} onClick={() => void run(async () => {
                const result = translationQualityFindings(activeReview, parseTranslationGlossary(glossary), checkNumbers);
                setQuality(result);
                setMessage(result.limited ? 'Showing the first 1,000 quality findings.' : `${result.findings.length} quality findings.`);
              })}>Check translation quality</button>
            </details>
            <TranslationReviewList key={review?.filename} review={activeReview} selected={selected}
              onSelection={updateSelection} findings={quality?.findings || []} onNavigate={locate} disabled={busy}
              onEdit={(key, parts) => {
                ensureCurrent();
                const value = updateReviewedTranslation(activeReview, key, parts);
                setReview({ revision, filename: review!.filename, value });
                updateSelection(new Set([...selected].filter(id => id !== key)));
                setQuality(undefined);
              }}/>
            <div className="publication-actions">
              <button className="action-btn" disabled={busy || !selected.size} onClick={() => void run(async () => {
                await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
                ensureCurrent();
                setProof(previewTranslatedEdition(stateManager.getState(), activeReview, selected));
              })}>Preview translated edition</button>
              <button className="sm-btn" disabled={busy || !selected.size} onClick={() => void run(async () => {
                ensureCurrent();
                const targets = reviewedTargets(activeReview, selected);
                const groups = catalog.groups.map(group => ({ ...group, units: group.units.filter(unit => targets.has(unit.key)) }))
                  .filter(group => group.units.length);
                const content = writeTranslationExchange(groups, activeReview.sourceLanguage, activeReview.targetLanguage, targets);
                if (await savePublicationFile(`${base}-${activeReview.targetLanguage}-reviewed.xlf`, content, 'application/xliff+xml')) {
                  setMessage('Reviewed translation exchange saved.');
                }
              })}>Download reviewed XLIFF</button>
              <button className="sm-btn" disabled={busy || activeReview.rows.every(row => row.status === 'unknown' || selected.has(row.key))}
                onClick={() => void run(async () => {
                  ensureCurrent();
                  const groups = outstandingTranslationGroups(catalog.groups, activeReview, selected);
                  const content = writeTranslationExchange(groups, activeReview.sourceLanguage, activeReview.targetLanguage);
                  if (await savePublicationFile(`${base}-${activeReview.targetLanguage}-outstanding.xlf`, content, 'application/xliff+xml')) {
                    setMessage('Outstanding units saved with the current source text.');
                  }
                })}>Download outstanding XLIFF</button>
              <button className="sm-btn" disabled={busy} onClick={() => void run(async () => {
                ensureCurrent();
                const content = translationReviewHtml(state.settings.title, activeReview, selected, quality?.findings || []);
                if (await savePublicationFile(`${base}-${activeReview.targetLanguage}-bilingual-review.html`, content, 'text/html;charset=utf-8')) {
                  setMessage('Bilingual review saved. The file contains source and translated copy.');
                }
              })}>Download bilingual review</button>
              <button className="sm-btn" disabled={busy || !selected.size} onClick={() => void run(async () => {
                ensureCurrent();
                const result = rememberReviewedTranslations(activeReview, selected);
                if (!result.memory.entries.length) throw new Error('Select at least one plain-text unit to remember. Protected inline codes stay in XLIFF.');
                const next = memory ? combineTranslationMemories(memory, result.memory) : result.memory;
                setMemory(next);
                setMessage(`Memory now contains ${next.entries.length} source entries. Save it from Prepare XLIFF to reuse it later.${result.skipped ? ` ${result.skipped} protected units were skipped.` : ''}`);
              })}>Add selected to translation memory</button>
            </div>
            {proof && <>
              <TranslationProof proof={proof} selected={selected.size} available={allUnits} navigate={locate}/>
              <div className="publication-actions">
                <button className="action-btn" disabled={busy} onClick={() => void run(async () => {
                  ensureCurrent();
                  if (await savePublicationFile(`${base}-${activeReview.targetLanguage}.recto`, JSON.stringify(proof.edition), 'application/json')) {
                    setMessage('Saved the editable translated edition.');
                  }
                })}>Save translated edition</button>
                <button className="sm-btn" disabled={busy} onClick={() => void run(async () => {
                  ensureCurrent();
                  const report = { sourceLanguage: activeReview.sourceLanguage, targetLanguage: activeReview.targetLanguage,
                    units: activeReview.rows.map(({ key, group, page, status }) => ({ key, group, page, status, selected: selected.has(key) })),
                    quality: quality?.findings || [], fonts: proof.fonts, layout: proof.layout, preflight: proof.preflight };
                  if (await savePublicationFile(`${base}-translation-report.json`, JSON.stringify(report, null, 2), 'application/json')) {
                    setMessage('Translation report saved.');
                  }
                })}>Download review report</button>
              </div>
            </>}
          </>}
        </>}
      </div>
      <footer className="translation-status">
        {busy && <p role="status">Working on the translation…</p>}
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
      </footer>
    </section>
  </div>;
}
