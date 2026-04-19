import { useState } from 'react';
import { ConnectionPanel } from '../ConnectionPanel/ConnectionPanel';
import { DbcPanel } from '../DbcPanel/DbcPanel';
import { FilterBar } from '../FilterBar/FilterBar';

interface Section {
  id: string;
  label: string;
  component: React.ReactNode;
  defaultOpen?: boolean;
}

const SECTIONS: Section[] = [
  { id: 'connection', label: 'Connection', component: <ConnectionPanel />, defaultOpen: true },
  { id: 'dbc',        label: 'DBC / Signals', component: <DbcPanel /> },
  { id: 'filter',     label: 'Filters', component: <FilterBar /> },
];

export function Sidebar() {
  const [open, setOpen] = useState<Record<string, boolean>>(
    Object.fromEntries(SECTIONS.map((s) => [s.id, s.defaultOpen ?? false])),
  );

  const toggle = (id: string) =>
    setOpen((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <div className="app-sidebar panel" style={styles.sidebar}>
      {SECTIONS.map((section) => (
        <div key={section.id}>
          <div
            className="accordion-header"
            onClick={() => toggle(section.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && toggle(section.id)}
          >
            <span className="accordion-title">{section.label}</span>
            <span className={`accordion-chevron ${open[section.id] ? 'open' : ''}`}>▼</span>
          </div>
          {open[section.id] && (
            <div className="accordion-body" style={styles.body}>
              {section.component}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    borderRight: '1px solid var(--border-subtle)',
    borderTop: 'none',
    borderLeft: 'none',
    borderBottom: 'none',
    overflowY: 'auto',
    overflowX: 'hidden',
  },
  body: {
    padding: '10px 12px',
    borderBottom: '1px solid var(--border-subtle)',
  },
};
