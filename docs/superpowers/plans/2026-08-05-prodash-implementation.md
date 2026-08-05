# 个人效率工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dark-themed React + Vite single-page productivity dashboard with a working four-quadrant todo tool, deployed to GitHub Pages.

**Architecture:** Single-page React app. `App` shell holds tab state; `TodoView` owns todo state through a generic `useLocalStorage` hook; dual list/quadrant views derive quadrant membership from `important`/`urgent` booleans; no backend, data persisted in localStorage; static build deployed to GitHub Pages via a GitHub Actions workflow.

**Tech Stack:** React 18, Vite 8, Vitest 4 + React Testing Library, plain CSS (dark theme), localStorage, GitHub Pages (GitHub Actions). Node v24 / npm 11 / git 2.55 already installed.

## Global Constraints

（来自设计文档，每个任务的实现都必须满足，不重复抄写）

- 使用 **JavaScript**，不使用 TypeScript。
- React 18 + Vite 单页应用，无后端。
- 数据存储 key 固定为 `prodash.todos.v1`。
- 待办字段：`{ id, text, done, important, urgent, createdAt }`，`id` 用 `crypto.randomUUID()` 生成。
- 象限由 `important` + `urgent` 推导（不单独存储象限字段）：
  - `true`/`true` → 重要·紧急（立即做）
  - `true`/`false` → 重要·不紧急（计划做）
  - `false`/`true` → 不重要·紧急（快速处理）
  - `false`/`false` → 不重要·不紧急（尽量少做）
- 双视图（列表 / 四象限）切换，切换不影响数据。
- 输入框含「重要？」「紧急？」两个开关；均不选时归「不重要·不紧急」，这是正常行为不是错误。
- 空或全空格输入不得创建待办。
- localStorage 读写必须 try/catch；写入失败时界面提示「保存失败，数据可能不会留存」，不得崩溃。
- 任何错误不得导致整个页面崩溃。
- 深色主题；手机窄屏响应式适配。
- 界面文案使用中文。

---

### Task 0: 项目脚手架（Vite + React + 测试工具链）

不交互式脚手架，直接手写最小工程文件，避免目录非空导致 create-vite 交互卡住。

**Files:**
- Create: `package.json`
- Create: `vite.config.js`
- Create: `index.html`
- Create: `.gitignore`
- Create: `src/main.jsx`
- Create: `src/App.jsx`
- Create: `src/setupTests.js`
- Create: `src/styles/theme.css`
- Create: `src/styles/components.css`

**Interfaces:**
- Produces: 可 `npm run dev` / `npm run build` / `npm test` 的最小 React 工程；`src/main.jsx` 导入 `./styles/theme.css` 与 `./styles/components.css`（后续任务依赖这两个文件存在）。

- [ ] **Step 1: 创建 `package.json`**

```json
{
  "name": "prodash",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^7.0.0",
    "@testing-library/react": "^16.3.2",
    "@testing-library/user-event": "^14.6.3",
    "@vitejs/plugin-react": "^6.0.5",
    "jsdom": "^30.0.1",
    "vite": "^8.0.0",
    "vitest": "^4.1.10"
  }
}
```

- [ ] **Step 2: 创建 `vite.config.js`**

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.js',
  },
})
```

说明：`base: './'` 让构建产物使用相对路径，GitHub Pages 部署到任意子路径都能工作，无需在部署时改配置。

- [ ] **Step 3: 创建 `index.html`**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>效率工作台</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 4: 创建 `.gitignore`**

```
node_modules
dist
*.local
```

- [ ] **Step 5: 创建 `src/main.jsx`**

```jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles/theme.css'
import './styles/components.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
```

- [ ] **Step 6: 创建 `src/setupTests.js`（含 randomUUID 兜底，jsdom 不一定提供）**

```js
import '@testing-library/jest-dom'

// jsdom 可能不实现 crypto.randomUUID，测试环境统一提供确定性实现
beforeAll(() => {
  if (!globalThis.crypto?.randomUUID) {
    globalThis.crypto = {
      ...globalThis.crypto,
      randomUUID: () => `test-${Math.random().toString(36).slice(2)}`,
    }
  }
})
```

- [ ] **Step 7: 创建 `src/App.jsx` 占位版（Task 4 会替换）**

```jsx
export default function App() {
  return <h1>效率工作台</h1>
}
```

- [ ] **Step 8: 创建 `src/styles/theme.css`（深色主题变量与基础样式）**

```css
:root {
  --bg: #0f1115;
  --surface: #1a1d23;
  --surface-hover: #23272f;
  --text: #e6e9ef;
  --text-muted: #8b93a3;
  --border: #2a2f3a;
  --accent: #6ea8fe;
  --danger: #f87171;
  --done: #4ade80;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif;
}
```

- [ ] **Step 9: 创建 `src/styles/components.css`（Task 5 填充完整样式，先建空文件占位）**

```css
/* 组件样式由 Task 5 填充 */
```

- [ ] **Step 10: 安装依赖并验证**

Run: `npm install`
Expected: 安装成功，无 peer dependency 冲突。

Run: `npm run build`
Expected: 构建成功，生成 `dist/`。

Run: `npm test`
Expected: PASS（`--passWithNoTests` 下无测试也通过）。

Run: `npm run dev` 后浏览器打开 `http://localhost:5173/`
Expected: 页面显示「效率工作台」，深色背景。（确认后停止 dev 进程）

- [ ] **Step 11: 提交**

```bash
git add -A
git commit -m "chore: scaffold vite react project with vitest tooling"
```

---

### Task 1: useLocalStorage 通用钩子（TDD）

**Files:**
- Create: `src/hooks/useLocalStorage.js`
- Test: `src/hooks/useLocalStorage.test.js`

**Interfaces:**
- Consumes: 无。
- Produces: `useLocalStorage(key: string, defaultValue: any)` → `[value, setValue, saveError]`
  - `value`: 当前值。初始化时从 localStorage 读取并 JSON 解析；读取失败或无存储时返回 `defaultValue`（`defaultValue` 为函数时调用它取返回值）。
  - `setValue`: `(next: any | (prev) => next) => void`，与 `useState` 的 setter 用法一致。
  - `saveError`: `boolean`，最近一次写入失败为 `true`，成功为 `false`。

- [ ] **Step 1: 写失败测试**

`src/hooks/useLocalStorage.test.js`：

```js
import { renderHook, act, waitFor } from '@testing-library/react'
import { useLocalStorage } from './useLocalStorage'

describe('useLocalStorage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  test('无存储内容时返回默认值', () => {
    const { result } = renderHook(() => useLocalStorage('k1', [1, 2]))
    expect(result.current[0]).toEqual([1, 2])
  })

  test('能读取已存在的存储值', () => {
    window.localStorage.setItem('k2', JSON.stringify({ a: 1 }))
    const { result } = renderHook(() => useLocalStorage('k2', null))
    expect(result.current[0]).toEqual({ a: 1 })
  })

  test('setValue 写入 localStorage', () => {
    const { result } = renderHook(() => useLocalStorage('k3', []))
    act(() => result.current[1]([3]))
    expect(JSON.parse(window.localStorage.getItem('k3'))).toEqual([3])
  })

  test('支持函数式更新', () => {
    const { result } = renderHook(() => useLocalStorage('k4', [1]))
    act(() => result.current[1]((prev) => [...prev, 2]))
    expect(result.current[0]).toEqual([1, 2])
    expect(JSON.parse(window.localStorage.getItem('k4'))).toEqual([1, 2])
  })

  test('defaultValue 为函数时调用它', () => {
    const { result } = renderHook(() => useLocalStorage('k5', () => 'x'))
    expect(result.current[0]).toBe('x')
  })

  test('存储内容损坏时回退默认值', () => {
    window.localStorage.setItem('k6', '{bad json')
    const { result } = renderHook(() => useLocalStorage('k6', 'fallback'))
    expect(result.current[0]).toBe('fallback')
  })

  test('写入失败时 saveError 为 true', async () => {
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('quota exceeded')
      })
    const { result } = renderHook(() => useLocalStorage('k7', []))
    act(() => result.current[1]([1]))
    await waitFor(() => expect(result.current[2]).toBe(true))
    spy.mockRestore()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/hooks/useLocalStorage.test.js`
Expected: FAIL，报错 `Cannot find module './useLocalStorage'` 或函数未导出。

- [ ] **Step 3: 写最小实现**

`src/hooks/useLocalStorage.js`：

```js
import { useEffect, useState } from 'react'

export function useLocalStorage(key, defaultValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key)
      if (stored !== null) {
        return JSON.parse(stored)
      }
    } catch {
      // 读取失败按默认值处理
    }
    return typeof defaultValue === 'function' ? defaultValue() : defaultValue
  })
  const [saveError, setSaveError] = useState(false)

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
      setSaveError(false)
    } catch {
      setSaveError(true)
    }
  }, [key, value])

  return [value, setValue, saveError]
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/hooks/useLocalStorage.test.js`
Expected: PASS，7 个用例全过。

- [ ] **Step 5: 提交**

```bash
git add src/hooks/useLocalStorage.js src/hooks/useLocalStorage.test.js
git commit -m "feat: add useLocalStorage hook"
```

---

### Task 2: 待办列表视图（TDD）

**Files:**
- Create: `src/lib/quadrants.js`
- Create: `src/components/TodoInput.jsx`
- Create: `src/components/TodoList.jsx`
- Create: `src/components/TodoItem.jsx`
- Create: `src/components/TodoView.jsx`
- Test: `src/components/TodoView.test.jsx`

**Interfaces:**
- Consumes: `useLocalStorage`（Task 1）。
- Produces:
  - `src/lib/quadrants.js`: `QUADRANTS`（key → `{ title, hint }`）、`QUADRANT_ORDER`（四个 key 的有序数组）、`getQuadrantKey(important, urgent)` → 象限 key。
  - `TodoView()`: 无 props。内部 `useLocalStorage('prodash.todos.v1', [])`，默认视图 `'list'`；渲染视图切换、输入区、保存失败提示、列表或四象限。
  - `TodoInput({ onAdd })`: `onAdd(text, important, urgent) => void`。
  - `TodoList({ todos, onToggle, onDelete })`: `onToggle(id)`、`onDelete(id)`。
  - `TodoItem({ todo, onToggle, onDelete })`: 渲染勾选框（aria-label「标记完成」）、文字、象限标签、删除按钮（文字「删除」）。

- [ ] **Step 1: 写失败测试**

`src/components/TodoView.test.jsx`：

```jsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TodoView from './TodoView'

async function addTodo(text) {
  const user = userEvent.setup()
  await user.type(screen.getByPlaceholderText(/添加待办/), text)
  await user.click(screen.getByRole('button', { name: '添加' }))
  return user
}

describe('TodoView 列表视图', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  test('添加待办后出现在列表中', async () => {
    render(<TodoView />)
    await addTodo('去超市买菜')
    expect(screen.getByText('去超市买菜')).toBeInTheDocument()
  })

  test('空输入不产生待办', async () => {
    render(<TodoView />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '添加' }))
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
  })

  test('勾选待办切换为已完成', async () => {
    render(<TodoView />)
    const user = await addTodo('写周报')
    await user.click(screen.getByRole('checkbox', { name: '标记完成' }))
    expect(screen.getByRole('checkbox', { name: '标记完成' })).toBeChecked()
  })

  test('删除待办后从列表消失', async () => {
    render(<TodoView />)
    const user = await addTodo('待删除')
    await user.click(screen.getByRole('button', { name: '删除' }))
    expect(screen.queryByText('待删除')).not.toBeInTheDocument()
  })

  test('写入失败时显示保存失败提示', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    render(<TodoView />)
    await addTodo('会失败的任务')
    expect(await screen.findByText(/保存失败/)).toBeInTheDocument()
    vi.restoreAllMocks()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/components/TodoView.test.jsx`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写最小实现**

`src/lib/quadrants.js`：

```js
export const QUADRANT_ORDER = [
  'important-urgent',
  'important-not-urgent',
  'not-important-urgent',
  'not-important-not-urgent',
]

export const QUADRANTS = {
  'important-urgent': { title: '重要·紧急', hint: '立即做' },
  'important-not-urgent': { title: '重要·不紧急', hint: '计划做' },
  'not-important-urgent': { title: '不重要·紧急', hint: '快速处理' },
  'not-important-not-urgent': { title: '不重要·不紧急', hint: '尽量少做' },
}

export function getQuadrantKey(important, urgent) {
  if (important && urgent) return 'important-urgent'
  if (important) return 'important-not-urgent'
  if (urgent) return 'not-important-urgent'
  return 'not-important-not-urgent'
}
```

`src/components/TodoInput.jsx`：

```jsx
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
```

`src/components/TodoItem.jsx`：

```jsx
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
```

`src/components/TodoList.jsx`：

```jsx
import TodoItem from './TodoItem'

export default function TodoList({ todos, onToggle, onDelete }) {
  if (todos.length === 0) {
    return <p className="empty-tip">还没有待办，添加一条吧</p>
  }
  return (
    <ul className="todo-list">
      {todos.map((todo) => (
        <TodoItem key={todo.id} todo={todo} onToggle={onToggle} onDelete={onDelete} />
      ))}
    </ul>
  )
}
```

`src/components/TodoView.jsx`：

```jsx
import { useState } from 'react'
import { useLocalStorage } from '../hooks/useLocalStorage'
import TodoViewToggle from './TodoViewToggle'
import TodoInput from './TodoInput'
import TodoList from './TodoList'
import QuadrantView from './QuadrantView'

const STORAGE_KEY = 'prodash.todos.v1'

export default function TodoView() {
  const [todos, setTodos, saveError] = useLocalStorage(STORAGE_KEY, [])
  const [view, setView] = useState('list')

  function addTodo(text, important, urgent) {
    const trimmed = text.trim()
    if (!trimmed) return
    const todo = {
      id: crypto.randomUUID(),
      text: trimmed,
      done: false,
      important,
      urgent,
      createdAt: new Date().toISOString(),
    }
    setTodos((prev) => [todo, ...prev])
  }

  function toggleTodo(id) {
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
    )
  }

  function deleteTodo(id) {
    setTodos((prev) => prev.filter((t) => t.id !== id))
  }

  return (
    <section className="todo-view">
      <TodoViewToggle view={view} onViewChange={setView} />
      <TodoInput onAdd={addTodo} />
      {saveError && (
        <p className="save-error" role="alert">
          保存失败，数据可能不会留存
        </p>
      )}
      {view === 'list' ? (
        <TodoList todos={todos} onToggle={toggleTodo} onDelete={deleteTodo} />
      ) : (
        <QuadrantView todos={todos} onToggle={toggleTodo} onDelete={deleteTodo} />
      )}
    </section>
  )
}
```

注意：`TodoView.jsx` 引用了 `TodoViewToggle` 与 `QuadrantView`。为让本任务可独立运行，**本 Step 需一并创建这两个文件**：`TodoViewToggle.jsx` 即为最终实现；`QuadrantView.jsx` 先建最小 stub（渲染 null），Task 3 会替换为完整实现。两个文件内容如下：

`src/components/TodoViewToggle.jsx`（最终实现）：

```jsx
export default function TodoViewToggle({ view, onViewChange }) {
  return (
    <div className="view-toggle" role="tablist" aria-label="视图切换">
      <button type="button" role="tab" aria-selected={view === 'list'} onClick={() => onViewChange('list')}>
        列表
      </button>
      <button type="button" role="tab" aria-selected={view === 'quadrant'} onClick={() => onViewChange('quadrant')}>
        四象限
      </button>
    </div>
  )
}
```

`src/components/QuadrantView.jsx`（占位，Task 3 补全）：

```jsx
export default function QuadrantView() {
  return null
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/components/TodoView.test.jsx`
Expected: PASS，5 个用例全过。

- [ ] **Step 5: 提交**

```bash
git add src/lib/quadrants.js src/components/
git commit -m "feat: add todo list view with persistence"
```

---

### Task 3: 四象限视图与视图切换（TDD）

**Files:**
- Create: `src/components/QuadrantView.jsx`（补全）
- Create: `src/components/QuadrantCell.jsx`
- Test: `src/components/QuadrantView.test.jsx`
- Modify: `src/components/QuadrantView.jsx`（从占位改为完整实现）

**Interfaces:**
- Consumes: `quadrants.js`（Task 2）、`TodoItem`（Task 2）。
- Produces:
  - `QuadrantView({ todos, onToggle, onDelete })`: 2x2 网格，四个 `QuadrantCell`。
  - `QuadrantCell({ quadrantKey, title, hint, todos, onToggle, onDelete })`: 渲染 `data-testid={`quadrant-${quadrantKey}`}`，标题、提示语、数量、待办列表。
  - `TodoViewToggle({ view, onViewChange })`: 已由 Task 2 创建，无需修改。

- [ ] **Step 1: 写失败测试**

`src/components/QuadrantView.test.jsx`：

```jsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TodoView from './TodoView'

async function addTodo(text, { important = false, urgent = false } = {}) {
  const user = userEvent.setup()
  await user.type(screen.getByPlaceholderText(/添加待办/), text)
  if (important) {
    await user.click(screen.getByRole('checkbox', { name: '重要？' }))
  }
  if (urgent) {
    await user.click(screen.getByRole('checkbox', { name: '紧急？' }))
  }
  await user.click(screen.getByRole('button', { name: '添加' }))
  return user
}

describe('四象限视图', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  async function switchToQuadrant() {
    await userEvent.setup().click(screen.getByRole('tab', { name: '四象限' }))
  }

  test('重要+紧急的待办出现在「重要·紧急」格', async () => {
    render(<TodoView />)
    await addTodo('紧急任务', { important: true, urgent: true })
    await switchToQuadrant()
    const cell = screen.getByTestId('quadrant-important-urgent')
    expect(within(cell).getByText('紧急任务')).toBeInTheDocument()
  })

  test('默认（都不选）归入「不重要·不紧急」', async () => {
    render(<TodoView />)
    await addTodo('随手记')
    await switchToQuadrant()
    const cell = screen.getByTestId('quadrant-not-important-not-urgent')
    expect(within(cell).getByText('随手记')).toBeInTheDocument()
  })

  test('视图切换不改变数据', async () => {
    render(<TodoView />)
    await addTodo('来回切换')
    await switchToQuadrant()
    await userEvent.setup().click(screen.getByRole('tab', { name: '列表' }))
    expect(screen.getByText('来回切换')).toBeInTheDocument()
  })

  test('四象限视图中可勾选完成', async () => {
    render(<TodoView />)
    await addTodo('格子内完成')
    await switchToQuadrant()
    const cell = screen.getByTestId('quadrant-not-important-not-urgent')
    const user = userEvent.setup()
    await user.click(within(cell).getByRole('checkbox', { name: '标记完成' }))
    expect(
      within(cell).getByRole('checkbox', { name: '标记完成' })
    ).toBeChecked()
  })

  test('四象限视图中可删除', async () => {
    render(<TodoView />)
    await addTodo('格子内删除')
    await switchToQuadrant()
    const cell = screen.getByTestId('quadrant-not-important-not-urgent')
    const user = userEvent.setup()
    await user.click(within(cell).getByRole('button', { name: '删除' }))
    expect(within(cell).queryByText('格子内删除')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/components/QuadrantView.test.jsx`
Expected: FAIL（`QuadrantView` 渲染 null，找不到象限格子）。

- [ ] **Step 3: 补全 `QuadrantView.jsx` 并创建 `QuadrantCell.jsx`**

`src/components/QuadrantView.jsx`：

```jsx
import { QUADRANT_ORDER, QUADRANTS, getQuadrantKey } from '../lib/quadrants'
import QuadrantCell from './QuadrantCell'

export default function QuadrantView({ todos, onToggle, onDelete }) {
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
          />
        )
      })}
    </div>
  )
}
```

`src/components/QuadrantCell.jsx`：

```jsx
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
```

- [ ] **Step 4: 运行全部测试确认通过**

Run: `npm test`
Expected: PASS（useLocalStorage 7 个 + TodoView 5 个 + QuadrantView 5 个）。

- [ ] **Step 5: 提交**

```bash
git add src/components/QuadrantView.jsx src/components/QuadrantCell.jsx src/components/QuadrantView.test.jsx
git commit -m "feat: add quadrant view with view toggle"
```

---

### Task 4: App 外壳、Tab 栏与占位页（TDD）

**Files:**
- Create: `src/components/PlaceholderView.jsx`
- Modify: `src/App.jsx`（替换 Task 0 占位版）
- Test: `src/App.test.jsx`

**Interfaces:**
- Consumes: `TodoView`（Task 2）、`PlaceholderView`。
- Produces:
  - `App()`: 默认 `activeTab = 'todo'`；Tab 定义 `[{key:'todo',label:'待办'},{key:'timer',label:'番茄钟'},{key:'notes',label:'笔记'},{key:'expenses',label:'记账'}]`；渲染标题「效率工作台」、Tab 栏（`role="tablist"`，每个按钮 `role="tab"` 带 `aria-selected`）、内容区。
  - `PlaceholderView({ title })`: 渲染标题与「敬请期待」。

- [ ] **Step 1: 写失败测试**

`src/App.test.jsx`：

```jsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

describe('App 外壳', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  test('默认停在待办页', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: '效率工作台' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '待办' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByPlaceholderText(/添加待办/)).toBeInTheDocument()
  })

  test('切换到番茄钟显示敬请期待', async () => {
    render(<App />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: '番茄钟' }))
    expect(screen.getByText('敬请期待')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '番茄钟' })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/添加待办/)).not.toBeInTheDocument()
  })

  test('切换回待办后数据仍在', async () => {
    render(<App />)
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText(/添加待办/), '跨页数据')
    await user.click(screen.getByRole('button', { name: '添加' }))
    await user.click(screen.getByRole('tab', { name: '笔记' }))
    await user.click(screen.getByRole('tab', { name: '待办' }))
    expect(screen.getByText('跨页数据')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/App.test.jsx`
Expected: FAIL（App 还是占位版，没有 Tab 与输入框）。

- [ ] **Step 3: 写最小实现**

`src/components/PlaceholderView.jsx`：

```jsx
export default function PlaceholderView({ title }) {
  return (
    <section className="placeholder-view">
      <h2>{title}</h2>
      <p>敬请期待</p>
    </section>
  )
}
```

`src/App.jsx`：

```jsx
import { useState } from 'react'
import TodoView from './components/TodoView'
import PlaceholderView from './components/PlaceholderView'

const TABS = [
  { key: 'todo', label: '待办' },
  { key: 'timer', label: '番茄钟' },
  { key: 'notes', label: '笔记' },
  { key: 'expenses', label: '记账' },
]

export default function App() {
  const [activeTab, setActiveTab] = useState('todo')
  return (
    <div className="app">
      <header className="app-header">
        <h1>效率工作台</h1>
      </header>
      <nav className="tab-bar" role="tablist" aria-label="功能导航">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <main className="app-main">
        {activeTab === 'todo' ? (
          <TodoView />
        ) : (
          <PlaceholderView title={TABS.find((t) => t.key === activeTab).label} />
        )}
      </main>
    </div>
  )
}
```

- [ ] **Step 4: 运行全部测试确认通过**

Run: `npm test`
Expected: PASS（17 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src/App.jsx src/components/PlaceholderView.jsx src/App.test.jsx
git commit -m "feat: add app shell with tabs and placeholder pages"
```

---

### Task 5: 深色主题视觉设计

本任务为 UI 视觉工作，实现时交给 @designer 完成（布局、层级、配色、响应式由设计师把握）。下面给出必须满足的约束与需要覆盖的 class 清单。

**Files:**
- Modify: `src/styles/theme.css`
- Modify: `src/styles/components.css`
- Modify（如需要）: `src/main.jsx`、各组件（仅加 class 挂钩，不改逻辑）

**Interfaces:**
- Consumes: Task 0-4 产出的所有组件与 class 名。
- Produces: 可用的深色主题样式。

- [ ] **Step 1: 完善 `theme.css` 调色板**

以 Task 0 的变量为起点，设计师可微调配色，但必须保持深色主题、中文界面、可读性（正文与背景对比度足够）。四个象限格子建议使用可区分的强调色，保证色盲场景也能靠标题区分。

- [ ] **Step 2: 填充 `components.css`**

必须覆盖以下 class（均已在组件中使用）：`.app`、`.app-header`、`.tab-bar`、`.app-main`、`.todo-view`、`.view-toggle`、`.todo-input`、`.todo-list`、`.todo-item`、`.is-done`（已完成文字加删除线）、`.todo-quadrant-tag`、`.empty-tip`、`.save-error`（醒目但非弹窗）、`.quadrant-view`（桌面 2x2 网格）、`.quadrant-cell`、`.quadrant-hint`、`.quadrant-count`、`.placeholder-view`。

- [ ] **Step 3: 响应式适配**

窄屏（≤640px）下：Tab 栏可横滑或换行、四象限格子单列堆叠或紧凑两列（设计师判断）、输入区控件不溢出。

- [ ] **Step 4: 验证**

Run: `npm run build`
Expected: 构建成功。

Run: `npm test`
Expected: 全部 PASS（样式改动不得破坏功能测试）。

手动检查：`npm run dev` 打开页面，检查深色主题、Tab 高亮、四象限布局、窄屏（浏览器开发者工具切手机宽度）表现。

- [ ] **Step 5: 提交**

```bash
git add src/styles/ src/main.jsx
git commit -m "style: dark theme for workbench UI"
```

---

### Task 6: 全量测试、构建与本地验收

**Files:**
- 无需新增（仅修复任何发现的失败）。

**Interfaces:**
- Consumes: Task 0-5 全部产出。

- [ ] **Step 1: 全量测试**

Run: `npm test`
Expected: PASS（17 个用例）。

- [ ] **Step 2: 生产构建**

Run: `npm run build`
Expected: 构建成功，无报错。

- [ ] **Step 3: 本地手动验收（对照设计文档第 10 节验收清单）**

Run: `npm run dev`，浏览器打开 `http://localhost:5173/`，逐项检查：
1. 深色工作台，默认停靠待办页
2. 添加/勾选/删除待办均正常
3. 打开重要/紧急开关添加，四象限视图对应格子中能看到该待办
4. 列表与四象限来回切换，数据一致
5. 刷新页面，数据仍在
6. 切换另外三个 Tab 显示「敬请期待」，切回后待办数据未变
7. 手机宽度下布局不破

任一项失败则修复后回到 Step 1 重跑。全部通过后停止 dev 进程。

- [ ] **Step 4: 提交（如有修复）**

```bash
git add -A
git commit -m "fix: resolve issues found in acceptance pass"
```

若无需修复则跳过本步。

---

### Task 7: 部署到 GitHub Pages

**Files:**
- Create: `.github/workflows/deploy.yml`
- Modify: 无（`vite.config.js` 已用 `base: './'`，无需按仓库名改动）

**Interfaces:**
- Consumes: Task 6 通过验收的构建产物。

- [ ] **Step 1: 创建 GitHub 仓库**

浏览器打开 https://github.com/new ，仓库名填 `prodash`，Public，不勾选任何初始化选项（README/.gitignore/license 都不要），点 Create repository。

（若本机已装 GitHub CLI：`gh repo create prodash --public --source=. --push`）

- [ ] **Step 2: 关联远程仓库并推送**

Run: `git remote add origin https://github.com/<你的用户名>/prodash.git`
Run: `git branch -M main`
Run: `git push -u origin main`
Expected: 推送成功，GitHub 仓库里能看到全部提交。

- [ ] **Step 3: 创建 GitHub Actions 部署工作流**

`.github/workflows/deploy.yml`：

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 4: 推送工作流并等待部署**

Run: `git add .github/workflows/deploy.yml`
Run: `git commit -m "ci: add github pages deployment workflow"`
Run: `git push`
然后在 GitHub 仓库页打开 **Actions** 标签，等待工作流跑完（约 1-2 分钟）。若工作流被要求权限批准，在 Settings → Actions → General 打开 **Allow GitHub Actions to create and approve pull requests** 相关的读写权限，或直接在仓库 Settings → Actions → Workflow permissions 选 **Read and write permissions** 后重新运行。

- [ ] **Step 5: 开启 Pages 并确认网址**

GitHub 仓库 → Settings → Pages：Source 选择 **GitHub Actions**（部署由工作流完成）。若 Source 选项无「GitHub Actions」，改用 `gh` 或直接在仓库 Settings → Pages 将 Source 设为 **Deploy from a branch** 的 `main` 分支的 `/docs` 目录不可用（本项目不是 /docs 结构），故必须用 GitHub Actions 方式。

Expected: 网址形如 `https://<你的用户名>.github.io/prodash/`，打开后页面正常。

- [ ] **Step 6: 线上验收**

对照 Task 6 的验收清单在线上网址复验一遍（重点：刷新持久化、四象限、Tab 切换）。把网址发给朋友确认可正常打开。

- [ ] **Step 7: 提交最终状态（无新文件则跳过）**

```bash
git status
```

---

## 实现顺序依赖

Task 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7（严格串行，前序任务产出的接口是后续任务的基础）。
