import cn from 'classnames';
import Badge from './primitives/Badge';
import Tooltip from './primitives/Tooltip';

const TABS = [
  { id: 'todo', label: '待办' },
  { id: 'report', label: '日报' },
  { id: 'notes', label: '笔记', disabled: true, badge: '即将上线' },
  { id: 'tokens', label: 'Token流水', disabled: true, badge: '即将上线' },
];

export default function AppShell({ activeTab, onTabChange, children }) {
  return (
    <div className="app-shell">
      <header className="app-shell__header">
        <h1 className="app-shell__title">效率工作台</h1>
        <nav className="app-shell__nav" aria-label="主导航">
          {TABS.map((tab) => (
            <div key={tab.id} className="app-shell__nav-item-wrapper">
              {tab.disabled ? (
                <Tooltip content="该功能将在后续版本开放">
                  <span className="app-shell__nav-item app-shell__nav-item--disabled">
                    {tab.label}
                    <Badge variant="default">{tab.badge}</Badge>
                  </span>
                </Tooltip>
              ) : (
                <button
                  className={cn('app-shell__nav-item', {
                    'is-active': activeTab === tab.id,
                  })}
                  onClick={() => onTabChange(tab.id)}
                  aria-current={activeTab === tab.id ? 'page' : undefined}
                >
                  {tab.label}
                </button>
              )}
            </div>
          ))}
        </nav>
      </header>
      <main className="app-shell__main">{children}</main>
    </div>
  );
}
