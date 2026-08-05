import { QUADRANT_ORDER, QUADRANTS, getQuadrantKey } from '../lib/quadrants'
import QuadrantCell from './QuadrantCell'

export default function QuadrantView({
  todos,
  onToggle,
  onDelete,
  timerCallbacks,
  getTodoSummary,
}) {
  return (
    <div className="quadrant-view">
      {QUADRANT_ORDER.map((key) => {
        const cellTodos = todos.filter(
          (t) => getQuadrantKey(t.important, t.urgent) === key
        )
        return (
          <QuadrantCell
            key={key}
            quadrantKey={key}
            title={QUADRANTS[key].title}
            hint={QUADRANTS[key].hint}
            todos={cellTodos}
            onToggle={onToggle}
            onDelete={onDelete}
            timerCallbacks={timerCallbacks}
            getTodoSummary={getTodoSummary}
          />
        )
      })}
    </div>
  )
}
