import { Trash2 } from 'lucide-react'
import cn from 'classnames'
import Checkbox from './primitives/Checkbox'
import IconButton from './primitives/IconButton'
import Badge from './primitives/Badge'
import TaskTimerControls from './TaskTimerControls'
import { getQuadrantKey, QUADRANTS } from '../lib/quadrants'

function formatDueTime(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// 象限徽标配色（与 tokens.css 的 --q1..--q4 对应）
const QUADRANT_COLORS = {
  'important-urgent': 'var(--q1)',
  'important-not-urgent': 'var(--q2)',
  'not-important-urgent': 'var(--q3)',
  'not-important-not-urgent': 'var(--q4)',
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
    <li
      className={cn('todo-item', { 'is-done': todo.done })}
      data-quadrant={quadrantKey}
    >
      <div className="todo-item__row">
        <Checkbox
          id={`task-${todo.id}`}
          aria-label="标记完成"
          checked={todo.done}
          onCheckedChange={() => onToggle(todo.id)}
        />
        <span className="todo-item__title">{todo.text}</span>
        {isDingtalk && todo.sourceLeader && (
          <span className="source-leader">来自 {todo.sourceLeader}</span>
        )}
        {todo.dueTime && <span className="due-time">截止 {formatDueTime(todo.dueTime)}</span>}
        {isDingtalk && todo.syncWriteback === 'pending' && (
          <span className="sync-pending" title="钉钉回写失败，等待下次同步重试">
            同步失败待重试
          </span>
        )}
        <Badge color={QUADRANT_COLORS[quadrantKey]}>{quadrant.title}</Badge>
        {/* 钉钉来源任务不可删除（后端 DELETE 亦拒绝，双保险）；计时不受影响 */}
        {!isDingtalk && (
          <IconButton
            icon={Trash2}
            label="删除"
            onClick={() => onDelete(todo.id)}
          />
        )}
      </div>
      <div className="todo-item__row todo-item__row--timers">
        <TaskTimerControls
          summary={summary}
          onStart={(track) => timerCallbacks.start(todo.id, track)}
          onPause={(track) => timerCallbacks.pause(todo.id, track)}
          onResume={(track) => timerCallbacks.resume(todo.id, track)}
          onStop={(track) => timerCallbacks.stop(todo.id, track)}
          disabled={todo.done}
        />
      </div>
    </li>
  )
}
