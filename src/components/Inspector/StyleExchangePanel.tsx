import { useState } from 'preact/hooks';
import { stateManager } from '../../state';
import { savePublicationFile } from '../../desktop';

export default function StyleExchangePanel() {
  const [message, setMessage] = useState('');
  return <details className="publication-panel"><summary>Share style sets</summary>
    <p>Import paragraph and character styles. Matching IDs update existing styles; other styles remain. Font files must be supplied separately.</p>
    <button className="sm-btn" onClick={async () => { try { const state = stateManager.getState(); await savePublicationFile('publication.rectostyles', JSON.stringify({ version: 1, paragraphStyles: state.paragraphStyles, characterStyles: state.characterStyles || [] }, null, 2), 'application/json'); setMessage('Style set saved.'); } catch (reason) { setMessage(String(reason)); } }}>Export styles</button>
    <label>Import styles<input type="file" accept=".rectostyles,.json" onChange={async event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (!file) return;
      try { if (file.size > 1024 * 1024) throw new Error('Choose a style set smaller than 1 MB.'); stateManager.importStyleSet(JSON.parse(await file.text())); setMessage('Styles imported. Use Undo to restore the previous styles.'); } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); }
    }}/></label>{message && <p role="status">{message}</p>}
  </details>;
}
