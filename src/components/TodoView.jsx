import { useState } from 'react'
import { useLocalStorage } from '../hooks/useLocalStorage'
import TodoViewToggle from './TodoViewToggle'
import TodoInput from './TodoInput'
import TodoList from './TodoList'
import QuadrantView from './QuadrantView'

const STORAGE_KEY = 'prodash.todos.v1'

export default function TodoView() {
  const [todos, setTodos, saveError] = useLocalStorage(STORAGE_KEY, [])
  const [view, setView] = useState('list')

  function addTodo(text, important, urgent) {
    const trimmed = text.trim()
    if (!trimmed) return
    const todo = {
      id: crypto.randomUUID(),
      text: trimmed,
      done: false,
      important,
      urgent,
      createdAt: new Date().toISOString(),
    }
    setTodos((prev) => [todo, ...prev])
  }

  function toggleTodo(id) {
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
    )
  }

  function deleteTodo(id) {
    setTodos((prev) => prev.filter((t) => t.id !== id))
  }

  return (
    <section className="todo-view">
      <TodoViewToggle view={view} onViewChange={setView} />
      <TodoInput onAdd={addTodo} />
      {saveError && (
        <p className="save-error" role="alert">
          保存失败，数据可能不会留存
        </p>
      )}
      {view === 'list' ? (
        <TodoList todos={todos} onToggle={toggleTodo} onDelete={deleteTodo} />
      ) : (
        <QuadrantView todos={todos} onToggle={toggleTodo} onDelete={deleteTodo} />
      )}
    </section>
  )
}
