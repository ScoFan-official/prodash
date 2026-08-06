import { useEffect, useState } from 'react'
import { useTaskTimers } from '../hooks/useTaskTimers'
import { getTasks, createTask, updateTask, deleteTask } from '../api/client'
import TodoViewToggle from './TodoViewToggle'
import TodoInput from './TodoInput'
import TodoList from './TodoList'
import QuadrantView from './QuadrantView'
import ActiveTimersBar from './ActiveTimersBar'
import TimeStatsView from './TimeStatsView'

// 服务端任务 → UI 形状。id 保持服务端数字 BIGINT；
// 与 timeStore 的 todoId（String(taskId)）比较时统一 String()（见 useTaskTimers）。
function normalizeTask(task) {
  return {
    id: task.id,
    text: task.title,
    done: task.status === 'completed',
    important: Boolean(task.important),
    urgent: Boolean(task.urgent),
    createdAt: task.createdAt,
    completedAt: task.completedAt,
  }
}

export default function TodoView() {
  const [todos, setTodos] = useState([])
  const [saveError, setSaveError] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [view, setView] = useState('list')
  const [deleteBlockedId, setDeleteBlockedId] = useState(null)
  const timers = useTaskTimers()

  // mount 时从 API 拉取待办，过滤软删除任务。
  useEffect(() => {
    let cancelled = false
    getTasks()
      .then((tasks) => {
        if (cancelled) return
        setTodos((tasks ?? []).filter((t) => t.status !== 'deleted').map(normalizeTask))
        setLoadError(false)
      })
      .catch(() => {
        if (cancelled) return
        setTodos([])
        setLoadError(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

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
    createTask({ title: trimmed, important, urgent })
      .then((task) => {
        setTodos((prev) => [normalizeTask(task), ...prev])
        setSaveError(false)
      })
      .catch(() => setSaveError(true))
  }

  function toggleTodo(id) {
    const target = todos.find((t) => t.id === id)
    if (!target) return
    const nextDone = !target.done
    // 标记完成时先停止该待办的全部计时；恢复未完成不自动恢复旧计时。
    if (nextDone) timers.stopForTodo(id)
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, done: nextDone } : t))
    )
    updateTask(id, { status: nextDone ? 'completed' : 'active' })
      .then(() => setSaveError(false))
      .catch(() => setSaveError(true))
  }

  function deleteTodo(id) {
    if (timers.hasRunning(id)) {
      setDeleteBlockedId(id)
      return
    }
    setDeleteBlockedId(null)
    setTodos((prev) => prev.filter((t) => t.id !== id))
    deleteTask(id)
      .then(() => setSaveError(false))
      .catch(() => setSaveError(true))
  }

  // 计时停止/暂停后自动清除删除拦截提示，允许继续删除。
  useEffect(() => {
    if (deleteBlockedId && !timers.hasRunning(deleteBlockedId)) {
      setDeleteBlockedId(null)
    }
  }, [deleteBlockedId, timers.hasRunning])

  return (
    <section className="todo-view">
      <ActiveTimersBar
        active={timers.active}
        todos={todos}
        onStop={timerCallbacks.stop}
      />
      <TodoViewToggle view={view} onViewChange={setView} />
      <TodoInput onAdd={addTodo} />
      {saveError && (
        <p className="save-error" role="alert">
          保存失败，数据可能不会留存
        </p>
      )}
      {timers.saveError && (
        <p className="save-error" role="alert">
          计时同步失败，刷新后可能丢失
        </p>
      )}
      {(loadError || timers.loadError) && (
        <p className="save-error" role="alert">
          {loadError ? '任务数据加载失败，可能不是最新状态' : '计时数据加载失败，可能不是最新状态'}
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
      ) : view === 'quadrant' ? (
        <QuadrantView
          todos={todos}
          onToggle={toggleTodo}
          onDelete={deleteTodo}
          timerCallbacks={timerCallbacks}
          getTodoSummary={timers.getTodoSummary}
        />
      ) : (
        <TimeStatsView
          active={timers.active}
          records={timers.records}
          todos={todos}
        />
      )}
    </section>
  )
}
