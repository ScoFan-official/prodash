import { useState } from 'react'
import TodoView from './components/TodoView'
import PlaceholderView from './components/PlaceholderView'

const TABS = [
  { key: 'todo', label: '待办' },
  { key: 'timer', label: '番茄钟' },
  { key: 'notes', label: '笔记' },
  { key: 'expenses', label: '记账' },
]

export default function App() {
  const [activeTab, setActiveTab] = useState('todo')
  return (
    <div className="app">
      <header className="app-header">
        <h1>效率工作台</h1>
      </header>
      <nav className="tab-bar" role="tablist" aria-label="功能导航">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <main className="app-main">
        {activeTab === 'todo' ? (
          <TodoView />
        ) : (
          <PlaceholderView title={TABS.find((t) => t.key === activeTab).label} />
        )}
      </main>
    </div>
  )
}
