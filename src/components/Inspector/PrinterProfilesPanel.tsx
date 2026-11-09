import { useState } from 'preact/hooks';
import type { ProjectState } from '../../types';
import { stateManager } from '../../state';
import { publicationSnapshot } from '../../engine/publicationReferences';
import { checkPrinterProfile, parsePrinterProfile, type PrinterIssue, type PrinterProfile } from '../../engine/printerProfiles';

const key = 'recto-printer-profiles-v1';
const defaults: PrinterProfile = { name: '', bleedMm: 3, minDpi: 300, maxInk: 320 };
function load(): PrinterProfile[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value.slice(0, 50).map(parsePrinterProfile) : [];
  } catch { return []; }
}

export default function PrinterProfilesPanel({ state, includeBleed, selected, onSelect }: {
  state: ProjectState; includeBleed: boolean; selected?: PrinterProfile; onSelect(profile?: PrinterProfile): void;
}) {
  const [profiles, setProfiles] = useState(load);
  const [draft, setDraft] = useState<PrinterProfile>(defaults);
  const [issues, setIssues] = useState<PrinterIssue[]>();
  const [message, setMessage] = useState('');
  const save = (next: PrinterProfile[]) => { localStorage.setItem(key, JSON.stringify(next)); setProfiles(next); };
  const act = (action: () => void) => { try { setMessage(''); action(); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } };
  const fields = [ ['bleedMm', 'Minimum bleed (mm)', 0, 50], ['minDpi', 'Minimum image resolution (dpi)', 0, 2400], ['maxInk', 'Maximum process ink (%)', 100, 400] ] as const;
  return <details><summary>Printer profiles</summary>
    <label>Active printer profile<select aria-label="Active printer profile" value={selected?.name || ''} onChange={event => {
      const profile = profiles.find(item => item.name === event.currentTarget.value);
      onSelect(profile); setDraft(profile || defaults); setIssues(undefined);
    }}><option value="">No printer profile</option>{profiles.map(profile => <option key={profile.name} value={profile.name}>{profile.name}</option>)}</select></label>
    <label>Printer profile name<input maxLength={80} value={draft.name} onInput={event => setDraft({ ...draft, name: event.currentTarget.value })}/></label>
    {fields.map(([field, label, min, max]) => <label key={field}>{label}<input aria-label={label} type="number" min={min} max={max} step={field === 'bleedMm' ? 0.1 : 1}
      value={draft[field]} onInput={event => setDraft({ ...draft, [field]: event.currentTarget.valueAsNumber })}/></label>)}
    <p>Required ICC: {draft.iccName || 'Any profile'}</p>
    <div className="publication-actions">
      <button className="sm-btn" disabled={!state.settings.colorManagement?.outputProfile} onClick={() => {
        const profile = state.settings.colorManagement!.outputProfile;
        setDraft({ ...draft, iccId: profile.id, iccName: profile.description });
      }}>Require current ICC</button>
      {draft.iccId && <button className="sm-btn" onClick={() => setDraft({ ...draft, iccId: undefined, iccName: undefined })}>Clear ICC requirement</button>}
      <button className="sm-btn" onClick={() => act(() => {
        const profile = parsePrinterProfile(draft);
        const next = [...profiles.filter(item => item.name !== profile.name), profile];
        if (next.length > 50) throw new Error('Save up to 50 printer profiles.');
        save(next); onSelect(profile); setIssues(undefined); setMessage('Printer profile saved locally and applied to exports.');
      })}>Save printer profile</button>
      <button className="sm-btn" disabled={!selected} onClick={() => act(() => {
        save(profiles.filter(item => item.name !== selected!.name)); onSelect(undefined); setDraft(defaults); setIssues(undefined);
      })}>Remove selected profile</button>
      <button className="sm-btn" disabled={!selected} onClick={() => act(() => {
        setIssues(checkPrinterProfile(selected!, publicationSnapshot(stateManager.getState()), includeBleed));
      })}>Check printer requirements</button>
    </div>
    <p>Profiles check bleed, ICC selection, image resolution and explicit process ink values. Review the finished PDF with your printer.</p>
    {message && <p role="status">{message}</p>}
    {issues && (issues.length ? <ul className="editorial-list">{issues.map((issue, index) => <li key={index}>
      <strong>{issue.severity === 'error' ? 'Fix' : 'Review'}{issue.page ? ` · Page ${issue.page}` : ''}</strong><p>{issue.message}</p>
      {issue.spread !== undefined && <button className="sm-btn" onClick={() => stateManager.setActiveSpread(issue.spread!)}>Go to page {issue.page}</button>}
    </li>)}</ul> : <p role="status">No printer profile issues found.</p>)}
  </details>;
}
