import { render, screen, act, fireEvent } from '@testing-library/react'
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

// 集成测试使用 fireEvent 同步派发事件 + 受控推进 fake timers，
// 避免 user-event 与 fake timers 的异步等待问题。
describe('TodoView 计时双轨控制（集成）', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function addTodo(text) {
    fireEvent.change(screen.getByPlaceholderText(/添加待办/), {
      target: { value: text },
    })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
  }

  test('待办行显示人工/Agent 两组开始按钮', () => {
    render(<TodoView />)
    addTodo('计时任务')
    expect(screen.getByRole('button', { name: '开始人工计时' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始Agent计时' })).toBeInTheDocument()
  })

  test('开始后显示暂停/停止，两轨可同时运行', () => {
    render(<TodoView />)
    addTodo('双轨任务')
    fireEvent.click(screen.getByRole('button', { name: '开始人工计时' }))
    fireEvent.click(screen.getByRole('button', { name: '开始Agent计时' }))
    expect(screen.getByRole('button', { name: '暂停人工计时' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '停止人工计时' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '暂停Agent计时' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '停止Agent计时' })).toBeInTheDocument()
  })

  test('累计时长按分钟显示（推进系统时间）', () => {
    vi.setSystemTime(1000)
    render(<TodoView />)
    addTodo('时长任务')
    fireEvent.click(screen.getByRole('button', { name: '开始人工计时' }))
    act(() => vi.advanceTimersByTime(2 * 60 * 1000))
    expect(screen.getByText('2 分钟')).toBeInTheDocument()
  })

  test('运行中删除被拒绝并显示提示，停止后允许删除', () => {
    render(<TodoView />)
    addTodo('受保护任务')
    fireEvent.click(screen.getByRole('button', { name: '开始人工计时' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(screen.getByText('受保护任务')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '停止人工计时' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(screen.queryByText('受保护任务')).not.toBeInTheDocument()
  })

  test('勾选完成自动停止全部计时，恢复未完成不自动恢复', () => {
    render(<TodoView />)
    addTodo('完成即停')
    fireEvent.click(screen.getByRole('button', { name: '开始人工计时' }))
    fireEvent.click(screen.getByRole('button', { name: '开始Agent计时' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '标记完成' }))
    expect(screen.queryByRole('button', { name: '停止人工计时' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '停止Agent计时' })).not.toBeInTheDocument()
    // 恢复未完成：回到开始状态，不自动恢复旧计时
    fireEvent.click(screen.getByRole('checkbox', { name: '标记完成' }))
    expect(screen.getByRole('button', { name: '开始人工计时' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始Agent计时' })).toBeInTheDocument()
  })
})
