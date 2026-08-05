import { useState } from 'react'

export default function TodoInput({ onAdd }) {
  const [text, setText] = useState('')
  const [important, setImportant] = useState(false)
  const [urgent, setUrgent] = useState(false)

  function handleAdd() {
    onAdd(text, important, urgent)
    setText('')
  }

  return (
    <div className="todo-input">
      <input
        type="text"
        value={text}
        placeholder="添加待办…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleAdd()
        }}
      />
      <label>
        <input
          type="checkbox"
          checked={important}
          onChange={(e) => setImportant(e.target.checked)}
        />
        重要？
      </label>
      <label>
        <input
          type="checkbox"
          checked={urgent}
          onChange={(e) => setUrgent(e.target.checked)}
        />
        紧急？
      </label>
      <button type="button" onClick={handleAdd} disabled={!text.trim()}>
        添加
      </button>
    </div>
  )
}
