import { useEffect, useState } from 'react'
import { useTaskTimers } from '../hooks/useTaskTimers'
import { getTasks, createTask, updateTask, deleteTask, syncTodos, getTodoSyncStatus } from '../api/client'
import SegmentedControl from './primitives/SegmentedControl'
import Banner from './primitives/Banner'
import Skeleton from './primitives/Skeleton'
import TodoInput from './TodoInput'
import TodoList from './TodoList'
import QuadrantView from './QuadrantView'
import ActiveTimersBar from './ActiveTimersBar'
import TimeStatsView from './TimeStatsView'

const VIEW_OPTIONS = [
  { value: 'list', label: '列表' },
  { value: 'quadrant', label: '四象限' },
  { value: 'stats', label: '统计' },
]

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
    source: task.source ?? 'local',
    sourceLeader: task.sourceLeader ?? null,
    dueTime: task.dueTime ?? null,
    dingtalkTaskId: task.dingtalkTaskId ?? null,
    syncWriteback: task.syncWriteback ?? 'none',
  }
}

export default function TodoView() {
  const [todos, setTodos] = useState([])
  const [loading, setLoading] = useState(true)
  const [saveError, setSaveError] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [view, setView] = useState('list')
  const [deleteBlockedId, setDeleteBlockedId] = useState(null)
  const [syncState, setSyncState] = useState('idle') // idle | syncing | success | failed
  const [syncMessage, setSyncMessage] = useState('')
  const [lastSyncAt, setLastSyncAt] = useState(null)
  const timers = useTaskTimers()

  // mount 时从 API 拉取待办，过滤软删除任务。
  useEffect(() => {
    let cancelled = false
    getTasks()
      .then((tasks) => {
        if (cancelled) return
        setTodos((tasks ?? []).filter((t) => t.status !== 'deleted').map(normalizeTask))
        setLoadError(false)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setTodos([])
        setLoadError(true)
        setLoading(false)
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

  function formatSyncTime(iso) {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('zh-CN')
  }

  // 页面加载触发一次同步（服务端 <2 分钟节流，成功静默）；读取上次同步时间；失败仅提示不阻塞。
  useEffect(() => {
    let cancelled = false
    syncTodos().catch(() => {
      if (!cancelled) setSyncState('failed')
    })
    getTodoSyncStatus()
      .then((s) => {
        if (!cancelled && s?.syncedAt) setLastSyncAt(s.syncedAt)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // 手动同步后刷新任务列表：成功/失败均重新拉取（导入或部分导入立即可见，无需刷新页面）。
  // mount 拉取逻辑保留在下方 useEffect（带 cancelled 防卸载后 setState）；此处供 handleSync 复用。
  function refreshTasks() {
    return getTasks()
      .then((tasks) => {
        setTodos((tasks ?? []).filter((t) => t.status !== 'deleted').map(normalizeTask))
        setLoadError(false)
      })
      .catch(() => {
        setTodos([])
        setLoadError(true)
      })
  }

  function handleSync() {
    setSyncState('syncing')
    setSyncMessage('')
    syncTodos()
      .then((r) => {
        setSyncState('success')
        if (r?.inFlight) {
          setSyncMessage('已有同步正在进行')
        } else {
          setSyncMessage(`同步成功，导入 ${r?.imported ?? 0} / 更新 ${r?.updated ?? 0}`)
          if (r?.syncedAt) setLastSyncAt(r.syncedAt)
        }
        refreshTasks()
      })
      .catch(() => {
        setSyncState('failed')
        setSyncMessage('钉钉同步失败，请稍后重试')
        refreshTasks()
      })
  }

  return (
    <section className="todo-view">
      <ActiveTimersBar
        active={timers.active}
        todos={todos}
        onStop={timerCallbacks.stop}
      />
      <SegmentedControl value={view} onValueChange={setView} options={VIEW_OPTIONS} />
      <div className="todo-sync-bar">
        <button type="button" className="btn btn--ghost" onClick={handleSync} disabled={syncState === 'syncing'}>
          {syncState === 'syncing' ? '同步中…' : '同步钉钉待办'}
        </button>
        {lastSyncAt && <span className="todo-sync-last">上次同步：{formatSyncTime(lastSyncAt)}</span>}
      </div>
      {syncState === 'success' && syncMessage && (
        <p className="sync-message" role="status">
          {syncMessage}
        </p>
      )}
      {syncState === 'failed' && syncMessage && (
        <Banner variant="error">{syncMessage}</Banner>
      )}
      <TodoInput onAdd={addTodo} />
      {saveError && (
        <Banner variant="error">保存失败，数据可能不会留存</Banner>
      )}
      {timers.saveError && (
        <Banner variant="error">计时同步失败，刷新后可能丢失</Banner>
      )}
      {(loadError || timers.loadError) && (
        <Banner variant="error">
          {loadError ? '任务数据加载失败，可能不是最新状态' : '计时数据加载失败，可能不是最新状态'}
        </Banner>
      )}
      {deleteBlockedId && (
        <Banner variant="error">有计时正在运行，请先停止或暂停后再删除</Banner>
      )}
      {loading ? (
        <div className="todo-view__loading">
          <Skeleton width="100%" height={56} />
          <Skeleton width="100%" height={56} />
          <Skeleton width="100%" height={56} />
        </div>
      ) : view === 'list' ? (
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
