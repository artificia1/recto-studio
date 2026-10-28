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
  activeTab?: 'properties' | 'styles' | 'pages' | 'layers' | 'links' | 'templates' | 'setup';
  onTabChange?: (tab: 'properties' | 'styles' | 'pages' | 'layers' | 'links' | 'templates' | 'setup') => void;
  isOpen?: boolean;
  onClose?: () => void;
}

export function InspectorPanel({ state, activeTab: propActiveTab, onTabChange, isOpen, onClose }: InspectorPanelProps) {
  const [internalTab, setInternalTab] = useState<'properties' | 'styles' | 'pages' | 'layers' | 'links' | 'templates' | 'setup'>('properties');
  const activeTab = propActiveTab !== undefined ? propActiveTab : internalTab;

  const handleTabClick = (tabId: 'properties' | 'styles' | 'pages' | 'layers' | 'links' | 'templates' | 'setup') => {
    setInternalTab(tabId);
    onTabChange?.(tabId);
  };

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
    <aside className={`inspector-panel ${isOpen ? 'mobile-open' : ''}`}>
      {onClose && (
        <div className="inspector-mobile-header">
          <span className="inspector-mobile-title">Inspector & Settings</span>
          <button
            className="inspector-mobile-close-btn"
            onClick={onClose}
            aria-label="Close Inspector"
            title="Close Inspector"
          >
            ✕
          </button>
        </div>
      )}
      <div className="inspector-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`inspector-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => handleTabClick(tab.id)}
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
