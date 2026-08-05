import { useEffect, useState } from 'react'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { useTaskTimers } from '../hooks/useTaskTimers'
import TodoViewToggle from './TodoViewToggle'
import TodoInput from './TodoInput'
import TodoList from './TodoList'
import QuadrantView from './QuadrantView'

const STORAGE_KEY = 'prodash.todos.v1'

export default function TodoView() {
  const [todos, setTodos, saveError] = useLocalStorage(STORAGE_KEY, [])
  const [view, setView] = useState('list')
  const [deleteBlockedId, setDeleteBlockedId] = useState(null)
  const timers = useTaskTimers()

  // 双轨控制回调：start/pause/resume/stop 均按 (todoId, track) 调用，由行内组件绑定 todoId。
  const timerCallbacks = {
    start: timers.start,
    pause: timers.pause,
    resume: timers.resume,
    stop: timers.stop,
  }

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
    const target = todos.find((t) => t.id === id)
    // 标记完成时先停止该待办的全部计时；恢复未完成不自动恢复旧计时。
    if (target && !target.done) {
      timers.stopForTodo(id)
    }
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
    )
  }

  function deleteTodo(id) {
    if (timers.hasRunning(id)) {
      setDeleteBlockedId(id)
      return
    }
    setDeleteBlockedId(null)
    setTodos((prev) => prev.filter((t) => t.id !== id))
  }

  // 计时停止/暂停后自动清除删除拦截提示，允许继续删除。
  useEffect(() => {
    if (deleteBlockedId && !timers.hasRunning(deleteBlockedId)) {
      setDeleteBlockedId(null)
    }
  }, [deleteBlockedId, timers.hasRunning])

  return (
    <section className="todo-view">
      <TodoViewToggle view={view} onViewChange={setView} />
      <TodoInput onAdd={addTodo} />
      {saveError && (
        <p className="save-error" role="alert">
          保存失败，数据可能不会留存
        </p>
      )}
      {deleteBlockedId && (
        <p className="delete-blocked" role="alert">
          有计时正在运行，请先停止或暂停后再删除
        </p>
      )}
      {view === 'list' ? (
        <TodoList
          todos={todos}
          onToggle={toggleTodo}
          onDelete={deleteTodo}
          timerCallbacks={timerCallbacks}
          getTodoSummary={timers.getTodoSummary}
        />
      ) : (
        <QuadrantView
          todos={todos}
          onToggle={toggleTodo}
          onDelete={deleteTodo}
          timerCallbacks={timerCallbacks}
          getTodoSummary={timers.getTodoSummary}
        />
      )}
    </section>
  )
}
