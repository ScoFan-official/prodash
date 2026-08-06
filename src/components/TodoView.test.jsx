import { render, screen, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TodoView from './TodoView'
import * as api from '../api/client'

const { mockTasks, apiMocks } = vi.hoisted(() => {
  const tasks = []
  const apiMocks = {
    getTasks: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    postTimeEvent: vi.fn(),
    getActiveSessions: vi.fn(),
    getRecords: vi.fn(),
  }
  return { mockTasks: tasks, apiMocks }
})

vi.mock('../api/client', () => apiMocks)

function makeTask(id, { title, important = false, urgent = false, status = 'active' } = {}) {
  return {
    id,
    title,
    important,
    urgent,
    status,
    createdAt: '2026-08-06T08:00:00.000Z',
    completedAt: status === 'completed' ? '2026-08-06T09:00:00.000Z' : null,
    deletedAt: null,
  }
}

// 共享的内存「后端」：createTask/updateTask/deleteTask 写入，getTasks 读取。
function installApiDefaults() {
  mockTasks.length = 0
  apiMocks.getTasks.mockImplementation(() =>
    Promise.resolve(mockTasks.map((t) => ({ ...t }))),
  )
  apiMocks.createTask.mockImplementation((body) => {
    const task = makeTask(mockTasks.length + 1, {
      title: body.title,
      important: body.important ?? false,
      urgent: body.urgent ?? false,
    })
    mockTasks.push(task)
    return Promise.resolve({ ...task })
  })
  apiMocks.updateTask.mockImplementation((id, patch) => {
    const task = mockTasks.find((t) => t.id === Number(id))
    if (task) Object.assign(task, patch)
    return Promise.resolve(task ? { ...task } : {})
  })
  apiMocks.deleteTask.mockImplementation((id) => {
    const index = mockTasks.findIndex((t) => t.id === Number(id))
    if (index >= 0) mockTasks.splice(index, 1)
    return Promise.resolve({})
  })
  apiMocks.postTimeEvent.mockResolvedValue({})
  apiMocks.getActiveSessions.mockResolvedValue([])
  apiMocks.getRecords.mockResolvedValue([])
}

async function addTodo(text) {
  const user = userEvent.setup()
  await user.type(screen.getByPlaceholderText(/添加待办/), text)
  await user.click(screen.getByRole('button', { name: '添加' }))
  return user
}

describe('TodoView 列表视图（API 数据源）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installApiDefaults()
  })

  test('添加待办后出现在列表中', async () => {
    render(<TodoView />)
    await addTodo('去超市买菜')
    expect(await screen.findByText('去超市买菜')).toBeInTheDocument()
    expect(api.createTask).toHaveBeenCalledWith({
      title: '去超市买菜',
      important: false,
      urgent: false,
    })
  })

  test('空输入不产生待办', async () => {
    render(<TodoView />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '添加' }))
    expect(api.createTask).not.toHaveBeenCalled()
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
  })

  test('勾选待办切换为已完成并调用 PATCH completed', async () => {
    render(<TodoView />)
    const user = await addTodo('写周报')
    await user.click(screen.getByRole('checkbox', { name: '标记完成' }))
    expect(screen.getByRole('checkbox', { name: '标记完成' })).toBeChecked()
    expect(api.updateTask).toHaveBeenCalledWith(1, { status: 'completed' })
  })

  test('取消完成调用 PATCH active 并回到未完成', async () => {
    render(<TodoView />)
    const user = await addTodo('写周报')
    const checkbox = screen.getByRole('checkbox', { name: '标记完成' })
    await user.click(checkbox)
    await user.click(checkbox)
    expect(api.updateTask).toHaveBeenLastCalledWith(1, { status: 'active' })
    expect(screen.getByRole('checkbox', { name: '标记完成' })).not.toBeChecked()
  })

  test('删除待办后从列表消失并调用 DELETE 软删除', async () => {
    render(<TodoView />)
    const user = await addTodo('待删除')
    await user.click(screen.getByRole('button', { name: '删除' }))
    expect(screen.queryByText('待删除')).not.toBeInTheDocument()
    expect(api.deleteTask).toHaveBeenCalledWith(1)
  })

  test('软删除任务不展示', async () => {
    mockTasks.push(makeTask(1, { title: '正常任务' }))
    mockTasks.push(makeTask(10, { title: '已删除任务', status: 'deleted' }))
    render(<TodoView />)
    expect(await screen.findByText('正常任务')).toBeInTheDocument()
    expect(screen.queryByText('已删除任务')).not.toBeInTheDocument()
  })

  test('mount 时从 API 拉取待办', async () => {
    mockTasks.push(makeTask(1, { title: '已有任务' }))
    render(<TodoView />)
    expect(await screen.findByText('已有任务')).toBeInTheDocument()
    expect(api.getTasks).toHaveBeenCalled()
  })

  test('创建失败时显示保存失败提示', async () => {
    apiMocks.createTask.mockRejectedValue(new Error('quota'))
    render(<TodoView />)
    await addTodo('会失败的任务')
    expect(await screen.findByText(/保存失败/)).toBeInTheDocument()
  })

  test('完成待办触发 PATCH completed 与 stop 事件', async () => {
    render(<TodoView />)
    const user = await addTodo('完成即停')
    // 先启动人工计时，完成时 stopForTodo 会为其 POST stop
    await user.click(screen.getByRole('button', { name: '开始人工计时' }))
    apiMocks.postTimeEvent.mockClear()
    apiMocks.updateTask.mockClear()

    await user.click(screen.getByRole('checkbox', { name: '标记完成' }))
    expect(api.updateTask).toHaveBeenCalledWith(1, { status: 'completed' })
    expect(api.postTimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 1, track: 'human', event: 'stop' }),
    )
  })

  test('删除运行中的待办被拦截且不调用 DELETE', async () => {
    render(<TodoView />)
    const user = await addTodo('受保护任务')
    await user.click(screen.getByRole('button', { name: '开始人工计时' }))
    apiMocks.deleteTask.mockClear()

    await user.click(screen.getByRole('button', { name: '删除' }))
    expect(screen.getByText('受保护任务')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(api.deleteTask).not.toHaveBeenCalled()
  })

  test('任务加载失败时显示错误横幅', async () => {
    apiMocks.getTasks.mockRejectedValue(new Error('network'))
    render(<TodoView />)
    expect(
      await screen.findByText('任务数据加载失败，可能不是最新状态'),
    ).toBeInTheDocument()
  })

  test('计时恢复失败时显示计时数据加载失败横幅', async () => {
    apiMocks.getActiveSessions.mockRejectedValue(new Error('boom'))
    render(<TodoView />)
    expect(
      await screen.findByText('计时数据加载失败，可能不是最新状态'),
    ).toBeInTheDocument()
  })

  test('计时同步失败时显示计时同步失败横幅', async () => {
    apiMocks.postTimeEvent.mockRejectedValue(new Error('boom'))
    render(<TodoView />)
    const user = await addTodo('同步失败任务')
    await user.click(screen.getByRole('button', { name: '开始人工计时' }))
    expect(await screen.findByText('计时同步失败，刷新后可能丢失')).toBeInTheDocument()
  })
})

// 集成测试使用 fireEvent 同步派发事件 + 受控推进 fake timers，
// 避免 user-event 与 fake timers 的异步等待问题。
describe('TodoView 计时双轨控制（集成）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installApiDefaults()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function flushAsync() {
    await act(async () => {})
  }

  function addTodo(text) {
    fireEvent.change(screen.getByPlaceholderText(/添加待办/), {
      target: { value: text },
    })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
  }

  test('待办行显示人工/Agent 两组开始按钮', async () => {
    render(<TodoView />)
    addTodo('计时任务')
    await flushAsync()
    expect(screen.getByRole('button', { name: '开始人工计时' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始Agent计时' })).toBeInTheDocument()
  })

  test('开始后显示暂停/停止，两轨可同时运行', async () => {
    render(<TodoView />)
    addTodo('双轨任务')
    await flushAsync()
    fireEvent.click(screen.getByRole('button', { name: '开始人工计时' }))
    fireEvent.click(screen.getByRole('button', { name: '开始Agent计时' }))
    expect(screen.getByRole('button', { name: '暂停人工计时' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '停止人工计时' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '暂停Agent计时' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '停止Agent计时' })).toBeInTheDocument()
    expect(api.postTimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 1, track: 'human', event: 'start' }),
    )
    expect(api.postTimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 1, track: 'agent', event: 'start' }),
    )
  })

  test('累计时长按分钟显示（推进系统时间）', async () => {
    vi.setSystemTime(1000)
    render(<TodoView />)
    addTodo('时长任务')
    await flushAsync()
    fireEvent.click(screen.getByRole('button', { name: '开始人工计时' }))
    act(() => vi.advanceTimersByTime(2 * 60 * 1000))
    expect(screen.getByText('2 分钟')).toBeInTheDocument()
  })

  test('运行中删除被拒绝并显示提示，停止后允许删除', async () => {
    render(<TodoView />)
    addTodo('受保护任务')
    await flushAsync()
    fireEvent.click(screen.getByRole('button', { name: '开始人工计时' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(screen.getByText('受保护任务')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(api.deleteTask).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '停止人工计时' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(screen.queryByText('受保护任务')).not.toBeInTheDocument()
    expect(api.deleteTask).toHaveBeenCalledWith(1)
    await flushAsync()
  })

  test('暂停后删除成功且无阻止提示', async () => {
    render(<TodoView />)
    addTodo('暂停可删')
    await flushAsync()
    fireEvent.click(screen.getByRole('button', { name: '开始人工计时' }))
    fireEvent.click(screen.getByRole('button', { name: '暂停人工计时' }))
    expect(screen.getByRole('button', { name: '继续人工计时' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('暂停可删')).not.toBeInTheDocument()
    await flushAsync()
  })

  test('勾选完成自动停止全部计时并 POST stop，恢复未完成不自动恢复', async () => {
    render(<TodoView />)
    addTodo('完成即停')
    await flushAsync()
    fireEvent.click(screen.getByRole('button', { name: '开始人工计时' }))
    fireEvent.click(screen.getByRole('button', { name: '开始Agent计时' }))
    apiMocks.postTimeEvent.mockClear()
    apiMocks.updateTask.mockClear()

    fireEvent.click(screen.getByRole('checkbox', { name: '标记完成' }))
    expect(screen.queryByRole('button', { name: '停止人工计时' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '停止Agent计时' })).not.toBeInTheDocument()
    expect(api.updateTask).toHaveBeenCalledWith(1, { status: 'completed' })
    // 两个轨道各 POST 一个 stop
    expect(api.postTimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 1, track: 'human', event: 'stop' }),
    )
    expect(api.postTimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 1, track: 'agent', event: 'stop' }),
    )

    // 恢复未完成：回到开始状态，不自动恢复旧计时
    fireEvent.click(screen.getByRole('checkbox', { name: '标记完成' }))
    expect(api.updateTask).toHaveBeenLastCalledWith(1, { status: 'active' })
    expect(screen.getByRole('button', { name: '开始人工计时' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始Agent计时' })).toBeInTheDocument()
    await flushAsync()
  })
})
