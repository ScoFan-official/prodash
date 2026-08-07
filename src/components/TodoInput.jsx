import { useState } from 'react';
import Button from './primitives/Button';
import Checkbox from './primitives/Checkbox';
import Card from './primitives/Card';

export default function TodoInput({ onAdd }) {
  const [title, setTitle] = useState('');
  const [important, setImportant] = useState(false);
  const [urgent, setUrgent] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    // 保持既有 onAdd(text, important, urgent) 位置参数契约（TodoView.addTodo 原样消费）。
    onAdd(trimmed, important, urgent);
    setTitle('');
    setImportant(false);
    setUrgent(false);
  }

  return (
    <Card className="todo-input">
      <form onSubmit={handleSubmit} className="todo-input__form">
        <input
          type="text"
          className="todo-input__field"
          placeholder="添加待办…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="todo-input__switches">
          <label className="todo-input__switch">
            <Checkbox
              id="todo-important"
              checked={important}
              onCheckedChange={setImportant}
            />
            <span>重要？</span>
          </label>
          <label className="todo-input__switch">
            <Checkbox
              id="todo-urgent"
              checked={urgent}
              onCheckedChange={setUrgent}
            />
            <span>紧急？</span>
          </label>
          <Button type="submit" disabled={!title.trim()}>
            添加
          </Button>
        </div>
      </form>
    </Card>
  );
}
