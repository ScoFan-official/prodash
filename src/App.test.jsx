import { render, screen, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

// ReportView 依赖后端 API，外壳测试里用桩替代，保证稳定。
vi.mock('./components/report/ReportView', () => ({
  default: () => <div data-testid="report-view">ReportView 桩</div>,
}))

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
    syncTodos: vi.fn(),
    getTodoSyncStatus: vi.fn(),
  }
  return { mockTasks: tasks, apiMocks }
})

vi.mock('./api/client', () => apiMocks)

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
  // TodoView mount 会静默触发同步 + 读取同步状态（Task 10），默认 mock 使其静默成功。
  apiMocks.syncTodos.mockResolvedValue({
    syncedAt: '2026-08-07T12:00:00.000Z', imported: 0, updated: 0,
    softDeleted: 0, writeback: { retried: 0, pending: 0 },
  })
  apiMocks.getTodoSyncStatus.mockResolvedValue({
    syncedAt: null, lastResult: null, profile: 'corp:user', inFlight: false, configured: true,
  })
}

describe('App 外壳', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installApiDefaults()
  })

  // TodoView mount 会异步拉取待办，渲染后 flush 掉 microtask，避免 act 警告。
  async function renderApp() {
    render(<App />)
    await act(async () => {})
  }

  test('默认停在待办页', async () => {
    await renderApp()
    expect(screen.getByRole('heading', { name: '效率工作台' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '待办' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByPlaceholderText(/添加待办/)).toBeInTheDocument()
  })

  test('不再显示番茄钟 Tab', async () => {
    await renderApp()
    expect(screen.queryByRole('button', { name: '番茄钟' })).not.toBeInTheDocument()
    expect(screen.queryByText('番茄钟')).not.toBeInTheDocument()
  })

  test('导航为 2 个可用项 + 2 个禁用项（笔记/Token流水 带徽标）', async () => {
    await renderApp()
    const nav = screen.getByRole('navigation', { name: '主导航' })
    // 可用导航项：待办 / 日报
    expect(within(nav).getAllByRole('button')).toHaveLength(2)
    // 禁用项以 span 呈现，不可点击
    expect(within(nav).queryByRole('button', { name: '笔记' })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('button', { name: 'Token流水' })).not.toBeInTheDocument()
    expect(within(nav).getByText('笔记')).toBeInTheDocument()
    expect(within(nav).getByText('Token流水')).toBeInTheDocument()
    expect(within(nav).getAllByText('即将上线')).toHaveLength(2)
  })

  test('点击日报导航项后渲染 ReportView', async () => {
    await renderApp()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '日报' }))
    expect(screen.getByTestId('report-view')).toBeInTheDocument()
  })

  test('笔记/Token流水为禁用态，不可切换', async () => {
    await renderApp()
    // 禁用项不是按钮，无法点击导航
    expect(screen.queryByRole('button', { name: '笔记' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Token流水' })).not.toBeInTheDocument()
    // 仍在待办页，占位视图不再渲染
    expect(screen.getByPlaceholderText(/添加待办/)).toBeInTheDocument()
    expect(screen.queryByText('敬请期待')).not.toBeInTheDocument()
  })

  test('切换回待办后数据仍在（API 数据源重新拉取）', async () => {
    await renderApp()
    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText(/添加待办/), '跨页数据')
    await user.click(screen.getByRole('button', { name: '添加' }))
    expect(await screen.findByText('跨页数据')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '日报' }))
    expect(screen.queryByPlaceholderText(/添加待办/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '待办' }))
    // 重新 mount TodoView 后从 API 拉取到此前创建的任务
    expect(await screen.findByText('跨页数据')).toBeInTheDocument()
    expect(apiMocks.getTasks).toHaveBeenCalledTimes(2)
  })
})

