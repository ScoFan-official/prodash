import TodoItem from './TodoItem'

export default function QuadrantCell({
  quadrantKey,
  title,
  hint,
  todos,
  onToggle,
  onDelete,
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
            <TodoItem key={todo.id} todo={todo} onToggle={onToggle} onDelete={onDelete} />
          ))}
        </ul>
      )}
    </section>
  )
}
