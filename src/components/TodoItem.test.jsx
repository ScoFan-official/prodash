import { render, screen } from '@testing-library/react'
import TodoItem from './TodoItem'

function renderItem(overrides = {}) {
  const todo = {
    id: 1,
    text: '领导任务',
    done: false,
    important: true,
    urgent: true,
    source: 'dingtalk',
    sourceLeader: '闫佳琪',
    dueTime: '2026-08-08T10:00:00.000Z',
    dingtalkTaskId: 'dt-1',
    syncWriteback: 'none',
    ...overrides,
  }
  return render(
    <TodoItem
      todo={todo}
      summary={null}
      onToggle={() => {}}
      onDelete={() => {}}
      timerCallbacks={{}}
    />,
  )
}

it('钉钉任务：渲染来源领导徽标与截止时间，无删除按钮', () => {
  renderItem()
  expect(screen.getByText('来自 闫佳琪')).toBeInTheDocument()
  expect(screen.getByText(/截止/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument()
})

it('本地任务：保留删除按钮，无来源徽标/截止时间', () => {
  renderItem({ source: 'local', sourceLeader: null, dueTime: null, dingtalkTaskId: null })
  expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument()
  expect(screen.queryByText(/来自/)).not.toBeInTheDocument()
  expect(screen.queryByText(/截止/)).not.toBeInTheDocument()
})

it('syncWriteback=pending 显示「同步失败待重试」标记', () => {
  renderItem({ syncWriteback: 'pending' })
  expect(screen.getByText('同步失败待重试')).toBeInTheDocument()
})

it('钉钉任务无标题编辑控件（标题锁定由后端 PATCH 忽略保证）', () => {
  renderItem()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
})

it('来源领导缺失（task get 失败）时不渲染徽标', () => {
  renderItem({ sourceLeader: null })
  expect(screen.queryByText(/来自/)).not.toBeInTheDocument()
})
