import { Inbox } from 'lucide-react'
import Card from './primitives/Card'
import Badge from './primitives/Badge'
import EmptyState from './primitives/EmptyState'
import TodoItem from './TodoItem'

// 象限强调色（与 tokens.css 的 --q1..--q4 对应），经 --quadrant-color 自定义属性下发给子元素。
const QUADRANT_COLORS = {
  'important-urgent': 'var(--q1)',
  'important-not-urgent': 'var(--q2)',
  'not-important-urgent': 'var(--q3)',
  'not-important-not-urgent': 'var(--q4)',
}

export default function QuadrantCell({
  quadrantKey,
  title,
  hint,
  todos,
  onToggle,
  onDelete,
  timerCallbacks,
  getTodoSummary,
}) {
  return (
    <Card
      className="quadrant-cell"
      data-testid={`quadrant-${quadrantKey}`}
      data-quadrant={quadrantKey}
      style={{ '--quadrant-color': QUADRANT_COLORS[quadrantKey] }}
    >
      <header className="quadrant-cell__header">
        <h3>{title}</h3>
        <Badge variant="default">{todos.length}</Badge>
      </header>
      {todos.length === 0 ? (
        <EmptyState icon={Inbox} title="暂无任务" description={hint} />
      ) : (
        <ul className="quadrant-cell__list">
          {todos.map((todo) => (
            <TodoItem
              key={todo.id}
              todo={todo}
              summary={getTodoSummary(todo.id)}
              onToggle={onToggle}
              onDelete={onDelete}
              timerCallbacks={timerCallbacks}
            />
          ))}
        </ul>
      )}
    </Card>
  )
}
