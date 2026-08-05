import TodoItem from './TodoItem'

export default function TodoList({
  todos,
  onToggle,
  onDelete,
  timerCallbacks,
  getTodoSummary,
}) {
  if (todos.length === 0) {
    return <p className="empty-tip">还没有待办，添加一条吧</p>
  }
  return (
    <ul className="todo-list">
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
  )
}
