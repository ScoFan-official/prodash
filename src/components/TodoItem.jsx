import { getQuadrantKey, QUADRANTS } from '../lib/quadrants'

export default function TodoItem({ todo, onToggle, onDelete }) {
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
      <button type="button" onClick={() => onDelete(todo.id)}>
        删除
      </button>
    </li>
  )
}
