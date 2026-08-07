import { getQuadrantKey, QUADRANTS } from '../lib/quadrants'
import TaskTimerControls from './TaskTimerControls'

function formatDueTime(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function TodoItem({
  todo,
  summary,
  onToggle,
  onDelete,
  timerCallbacks,
}) {
  const quadrantKey = getQuadrantKey(todo.important, todo.urgent)
  const quadrant = QUADRANTS[quadrantKey]
  const isDingtalk = todo.source === 'dingtalk'
  return (
    <li className={`todo-item${todo.done ? ' is-done' : ''}`} data-quadrant={quadrantKey}>
      <input
        type="checkbox"
        checked={todo.done}
        onChange={() => onToggle(todo.id)}
        aria-label="标记完成"
      />
      <span className="todo-text">{todo.text}</span>
      {isDingtalk && todo.sourceLeader && (
        <span className="source-leader">来自 {todo.sourceLeader}</span>
      )}
      {todo.dueTime && <span className="due-time">截止 {formatDueTime(todo.dueTime)}</span>}
      {isDingtalk && todo.syncWriteback === 'pending' && (
        <span className="sync-pending" title="钉钉回写失败，等待下次同步重试">
          同步失败待重试
        </span>
      )}
      <span className="todo-quadrant-tag">{quadrant.title}</span>
      <TaskTimerControls
        summary={summary}
        onStart={(track) => timerCallbacks.start(todo.id, track)}
        onPause={(track) => timerCallbacks.pause(todo.id, track)}
        onResume={(track) => timerCallbacks.resume(todo.id, track)}
        onStop={(track) => timerCallbacks.stop(todo.id, track)}
        disabled={todo.done}
      />
      {/* 钉钉来源任务不可删除（后端 DELETE 亦拒绝，双保险）；计时不受影响 */}
      {!isDingtalk && (
        <button type="button" onClick={() => onDelete(todo.id)}>
          删除
        </button>
      )}
    </li>
  )
}
