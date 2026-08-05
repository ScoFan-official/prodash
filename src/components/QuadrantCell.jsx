import TodoItem from './TodoItem'

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
    <section className="quadrant-cell" data-testid={`quadrant-${quadrantKey}`}>
      <header>
        <h3>{title}</h3>
        <span className="quadrant-hint">{hint}</span>
        <span className="quadrant-count">{todos.length}</span>
      </header>
      {todos.length === 0 ? (
        <p className="empty-tip">暂无</p>
      ) : (
        <ul>
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
    </section>
  )
}
