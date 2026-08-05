import { getQuadrantKey, QUADRANTS } from '../lib/quadrants'
import TaskTimerControls from './TaskTimerControls'

export default function TodoItem({
  todo,
  summary,
  onToggle,
  onDelete,
  timerCallbacks,
}) {
  const quadrant = QUADRANTS[getQuadrantKey(todo.important, todo.urgent)]
  return (
    <li className={`todo-item${todo.done ? ' is-done' : ''}`}>
      <input
        type="checkbox"
        checked={todo.done}
        onChange={() => onToggle(todo.id)}
        aria-label="标记完成"
      />
      <span className="todo-text">{todo.text}</span>
      <span className="todo-quadrant-tag">{quadrant.title}</span>
      <TaskTimerControls
        summary={summary}
        onStart={(track) => timerCallbacks.start(todo.id, track)}
        onPause={(track) => timerCallbacks.pause(todo.id, track)}
        onResume={(track) => timerCallbacks.resume(todo.id, track)}
        onStop={(track) => timerCallbacks.stop(todo.id, track)}
        disabled={todo.done}
      />
      <button type="button" onClick={() => onDelete(todo.id)}>
        删除
      </button>
    </li>
  )
}
