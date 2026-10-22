import { useState } from 'preact/hooks';
import { PropertiesTab } from './PropertiesTab';
import { StylesTab } from './StylesTab';
import { PagesTab } from './PagesTab';
import { LayersTab } from './LayersTab';
import { LinksTab } from './LinksTab';
import { TemplatesTab } from './TemplatesTab';
import { SetupTab } from './SetupTab';
import { ProjectState } from '../../types';

interface InspectorPanelProps {
  state: ProjectState;
}

export function InspectorPanel({ state }: InspectorPanelProps) {
  const [activeTab, setActiveTab] = useState<'properties' | 'styles' | 'pages' | 'layers' | 'links' | 'templates' | 'setup'>('properties');

  const tabs: { id: 'properties' | 'styles' | 'pages' | 'layers' | 'links' | 'templates' | 'setup'; label: string }[] = [
    { id: 'properties', label: 'Properties' },
    { id: 'styles', label: 'Styles' },
    { id: 'pages', label: 'Pages' },
    { id: 'layers', label: 'Layers' },
    { id: 'links', label: 'Links' },
    { id: 'templates', label: 'Templates' },
    { id: 'setup', label: 'Setup' },
  ];

  return (
    <aside className="inspector-panel">
      <div className="inspector-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`inspector-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            title={tab.label}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="inspector-content">
        {activeTab === 'properties' && <PropertiesTab state={state} />}
        {activeTab === 'styles' && <StylesTab state={state} />}
        {activeTab === 'pages' && <PagesTab state={state} />}
        {activeTab === 'layers' && <LayersTab state={state} />}
        {activeTab === 'links' && <LinksTab state={state} />}
        {activeTab === 'templates' && <TemplatesTab state={state} />}
        {activeTab === 'setup' && <SetupTab state={state} />}
      </div>
    </aside>
  );
}
