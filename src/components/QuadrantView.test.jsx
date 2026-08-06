import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TodoView from './TodoView'

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

function installApiDefaults() {
  mockTasks.length = 0
  apiMocks.getTasks.mockImplementation(() =>
    Promise.resolve(mockTasks.map((t) => ({ ...t }))),
  )
  apiMocks.createTask.mockImplementation((body) => {
    const task = {
      id: mockTasks.length + 1,
      title: body.title,
      important: body.important ?? false,
      urgent: body.urgent ?? false,
      status: 'active',
      createdAt: '2026-08-06T08:00:00.000Z',
      completedAt: null,
      deletedAt: null,
    }
    mockTasks.push(task)
    return Promise.resolve({ ...task })
  })
  apiMocks.updateTask.mockResolvedValue({})
  apiMocks.deleteTask.mockResolvedValue({})
  apiMocks.postTimeEvent.mockResolvedValue({})
  apiMocks.getActiveSessions.mockResolvedValue([])
  apiMocks.getRecords.mockResolvedValue([])
}

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
    vi.clearAllMocks()
    installApiDefaults()
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

  test('四象限视图中显示双轨计时控制', async () => {
    render(<TodoView />)
    await addTodo('格子内计时')
    await switchToQuadrant()
    const cell = screen.getByTestId('quadrant-not-important-not-urgent')
    expect(within(cell).getByRole('button', { name: '开始人工计时' })).toBeInTheDocument()
    expect(within(cell).getByRole('button', { name: '开始Agent计时' })).toBeInTheDocument()
  })

  test('四象限视图中运行中的待办删除被拒绝并提示', async () => {
    render(<TodoView />)
    const user = await addTodo('格子内保护')
    await switchToQuadrant()
    const cell = screen.getByTestId('quadrant-not-important-not-urgent')
    await user.click(within(cell).getByRole('button', { name: '开始人工计时' }))
    await user.click(within(cell).getByRole('button', { name: '删除' }))
    expect(within(cell).getByText('格子内保护')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
