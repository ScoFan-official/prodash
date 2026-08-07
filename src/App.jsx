import { useState } from 'react';
import AppShell from './components/AppShell';
import TodoView from './components/TodoView';
import ReportView from './components/report/ReportView';

export default function App() {
  const [activeTab, setActiveTab] = useState('todo');

  return (
    <AppShell activeTab={activeTab} onTabChange={setActiveTab}>
      {activeTab === 'todo' && <TodoView />}
      {activeTab === 'report' && <ReportView />}
    </AppShell>
  );
}
