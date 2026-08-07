import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ReportView from './ReportView'
import * as api from '../../api/client'

vi.mock('../../api/client')

function todayString() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const SOURCE = {
  completedTodos: [
    { id: '1', title: '完成接口联调', humanMs: 3600000, agentMs: 600000 },
    { id: '2', title: '写日报', humanMs: 1800000, agentMs: 0 },
  ],
  pendingTodos: [{ id: '3', title: '整理文档', humanMs: 0, agentMs: 0 }],
  totalHumanMs: 5400000,
  totalAgentMs: 600000,
}

const EMPTY_EXTRA = { temporaryWork: '', meetings: '', risks: '', tomorrowPlan: '' }

function ensureClipboard() {
  if (!navigator.clipboard) {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn() },
      configurable: true,
    })
  }
}

describe('ReportView 日报', () => {
  beforeEach(() => {
    ensureClipboard()
    vi.clearAllMocks()
    api.getReportSource.mockResolvedValue(SOURCE)
    api.getReport.mockResolvedValue({ report: null, extra: null })
    api.listReports.mockResolvedValue([])
  })

  test('加载后渲染来源摘要（任务数 + 双轨总时长）', async () => {
    render(<ReportView />)
    expect(await screen.findByText(/已完成 2 个/)).toBeInTheDocument()
    expect(screen.getByText(/未完成 1 个/)).toBeInTheDocument()
    expect(screen.getByText(/双轨总时长：人工 1小时30分钟，AI 10分钟/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '生成日报' })).toBeInTheDocument()
  })

  test('生成成功显示结果、版本状态与 docUrl 链接', async () => {
    api.generateReport.mockResolvedValue({
      date: todayString(),
      status: 'draft',
      content: '今日完成\n1. 完成接口联调',
      version: 1,
      docUrl: 'https://wiki.example.com/reports/1',
    })
    render(<ReportView />)
    await screen.findByText(/已完成 2 个/)
    await userEvent.click(screen.getByRole('button', { name: '生成日报' }))
    expect(await screen.findByText(/完成接口联调/)).toBeInTheDocument()
    expect(screen.getByText(/版本：1，状态：草稿/)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: '在钉钉知识库查看' })
    expect(link).toHaveAttribute('href', 'https://wiki.example.com/reports/1')
  })

  test('生成失败显示错误且已输入内容不丢失', async () => {
    api.generateReport.mockRejectedValue(new Error('日报生成服务暂时不可用'))
    render(<ReportView />)
    await screen.findByText(/已完成 2 个/)
    const textarea = screen.getByLabelText('临时工作')
    await userEvent.type(textarea, '联调接口')
    await userEvent.click(screen.getByRole('button', { name: '生成日报' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('日报生成服务暂时不可用')
    expect(screen.getByLabelText('临时工作')).toHaveValue('联调接口')
  })

  test('publish_failed 显示补发按钮且点击调用 publishReport', async () => {
    api.getReport.mockResolvedValue({
      report: {
        date: todayString(),
        status: 'publish_failed',
        content: '发布失败内容',
        version: 1,
        docUrl: null,
      },
      extra: null,
    })
    api.publishReport.mockResolvedValue({
      date: todayString(),
      status: 'published',
      content: '发布成功内容',
      version: 1,
      docUrl: 'https://wiki.example.com/reports/2',
    })
    render(<ReportView />)
    await screen.findByText(/发布失败内容/)
    const publishButton = screen.getByRole('button', { name: '补发' })
    expect(publishButton).toBeInTheDocument()
    await userEvent.click(publishButton)
    expect(api.publishReport).toHaveBeenCalledWith(todayString())
    expect(await screen.findByText(/发布成功内容/)).toBeInTheDocument()
  })

  test('保存补充内容调用 saveExtra 并重新拉取刷新展示', async () => {
    api.getReport
      .mockResolvedValueOnce({
        report: {
          date: todayString(),
          status: 'published',
          content: '旧内容',
          version: 1,
          docUrl: null,
        },
        extra: null,
      })
      .mockResolvedValue({
        report: {
          date: todayString(),
          status: 'published',
          content: '重新生成后的新内容',
          version: 2,
          docUrl: null,
        },
        extra: { ...EMPTY_EXTRA, temporaryWork: '临时工作' },
      })
    api.saveExtra.mockResolvedValue({})
    render(<ReportView />)
    await screen.findByText(/旧内容/)
    await userEvent.type(screen.getByLabelText('临时工作'), '临时工作')
    await userEvent.click(screen.getByRole('button', { name: '保存补充内容' }))
    expect(api.saveExtra).toHaveBeenCalledWith(
      todayString(),
      expect.objectContaining({ temporaryWork: '临时工作' })
    )
    expect(await screen.findByText(/重新生成后的新内容/)).toBeInTheDocument()
  })

  test('复制成功显示提示', async () => {
    api.getReport.mockResolvedValue({
      report: {
        date: todayString(),
        status: 'published',
        content: '今日内容',
        version: 1,
        docUrl: null,
      },
      extra: null,
    })
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    render(<ReportView />)
    await screen.findByText(/今日内容/)
    await userEvent.click(screen.getByRole('button', { name: '复制日报' }))
    expect(writeText).toHaveBeenCalledWith('今日内容')
    expect(await screen.findByText('已复制到剪贴板')).toBeInTheDocument()
  })

  test('复制失败显示手动复制提示', async () => {
    api.getReport.mockResolvedValue({
      report: {
        date: todayString(),
        status: 'published',
        content: '今日内容',
        version: 1,
        docUrl: null,
      },
      extra: null,
    })
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockRejectedValue(new Error('denied'))
    render(<ReportView />)
    await screen.findByText(/今日内容/)
    await userEvent.click(screen.getByRole('button', { name: '复制日报' }))
    expect(writeText).toHaveBeenCalledWith('今日内容')
    expect(await screen.findByText('请手动选择并复制')).toBeInTheDocument()
  })

  test('切日期后旧日期生成响应晚到被丢弃，视图保持新日期', async () => {
    const genDeferred = deferred()
    api.generateReport.mockReturnValue(genDeferred.promise)

    const dateB = (() => {
      const [y, m, day] = todayString().split('-').map(Number)
      const other = day > 1 ? day - 1 : day + 1
      return `${y}-${String(m).padStart(2, '0')}-${String(other).padStart(2, '0')}`
    })()

    const sourceB = {
      completedTodos: [{ id: 'b1', title: 'B日任务', humanMs: 600000, agentMs: 0 }],
      pendingTodos: [],
      totalHumanMs: 600000,
      totalAgentMs: 0,
    }
    api.getReportSource.mockImplementation((d) =>
      Promise.resolve(d === dateB ? sourceB : SOURCE)
    )
    api.getReport.mockImplementation((d) =>
      Promise.resolve(
        d === dateB
          ? {
              report: {
                date: dateB,
                status: 'draft',
                content: 'B日期已有内容',
                version: 1,
                docUrl: null,
              },
              extra: null,
            }
          : { report: null, extra: null }
      )
    )

    render(<ReportView />)
    await screen.findByText(/已完成 2 个/)

    // A 日期（今天）点击生成，响应挂起
    await userEvent.click(screen.getByRole('button', { name: '生成日报' }))
    expect(api.generateReport).toHaveBeenCalledWith(
      expect.objectContaining({ date: todayString(), includeDeleted: false })
    )

    // 立即切到 B 日期，B 加载完成展示 B 内容
    // （日期选择器已改为 Radix Select：打开下拉并点击对应选项）
    await userEvent.click(screen.getByRole('combobox'))
    await userEvent.click(await screen.findByRole('option', { name: dateB }))
    expect(await screen.findByText(/B日期已有内容/)).toBeInTheDocument()

    // A 的响应姗姗来迟：应被丢弃，不覆盖 B 视图
    genDeferred.resolve({
      date: todayString(),
      status: 'draft',
      content: 'A日期生成的内容',
      version: 1,
      docUrl: null,
    })
    await waitFor(() => expect(api.getReportSource).toHaveBeenCalledWith(dateB, false))
    expect(screen.queryByText(/A日期生成的内容/)).not.toBeInTheDocument()
    expect(screen.getByText(/B日期已有内容/)).toBeInTheDocument()
  })

  test('draft 状态且已有内容也显示补发按钮', async () => {
    api.getReport.mockResolvedValue({
      report: {
        date: todayString(),
        status: 'draft',
        content: '草稿内容',
        version: 1,
        docUrl: null,
      },
      extra: null,
    })
    render(<ReportView />)
    await screen.findByText(/草稿内容/)
    expect(screen.getByRole('button', { name: '补发' })).toBeInTheDocument()
  })

  test('draft 状态但无内容时不显示补发按钮', async () => {
    api.getReport.mockResolvedValue({
      report: {
        date: todayString(),
        status: 'draft',
        content: '',
        version: 1,
        docUrl: null,
      },
      extra: null,
    })
    render(<ReportView />)
    await screen.findByText(/版本：1，状态：草稿/)
    expect(screen.queryByRole('button', { name: '补发' })).not.toBeInTheDocument()
  })

  test('includeDeleted 开关状态传递给 getReportSource 与 generateReport', async () => {
    render(<ReportView />)
    await screen.findByText(/已完成 2 个/)
    await userEvent.click(screen.getByLabelText('日报中包含已删除任务'))
    expect(api.getReportSource).toHaveBeenLastCalledWith(todayString(), true)
    await screen.findByRole('button', { name: '生成日报' })
    await userEvent.click(screen.getByRole('button', { name: '生成日报' }))
    expect(api.generateReport).toHaveBeenCalledWith(
      expect.objectContaining({ includeDeleted: true })
    )
  })

  test('历史列表渲染日期、状态、版本与知识库链接', async () => {
    api.listReports.mockResolvedValue([
      {
        date: '2026-08-04',
        status: 'published',
        version: 3,
        docUrl: 'https://wiki.example.com/reports/4',
        updatedAt: '2026-08-04T18:30:00Z',
      },
      {
        date: '2026-08-05',
        status: 'draft',
        version: 1,
        docUrl: null,
        updatedAt: '2026-08-05T10:00:00Z',
      },
    ])
    render(<ReportView />)
    await screen.findByText('2026-08-04')
    expect(screen.getByText('2026-08-05')).toBeInTheDocument()
    expect(screen.getByText('已发布')).toBeInTheDocument()
    expect(screen.getByText('草稿')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: '在钉钉知识库查看' })
    expect(link).toHaveAttribute('href', 'https://wiki.example.com/reports/4')
  })

  test('生成成功后刷新历史列表', async () => {
    api.generateReport.mockResolvedValue({
      date: todayString(),
      status: 'draft',
      content: '新生成内容',
      version: 1,
      docUrl: null,
    })
    render(<ReportView />)
    await screen.findByText(/已完成 2 个/)
    expect(api.listReports).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: '生成日报' }))
    await screen.findByText(/新生成内容/)
    await waitFor(() => expect(api.listReports).toHaveBeenCalledTimes(2))
  })

  test('历史列表加载失败时静默降级，不阻塞主视图', async () => {
    api.listReports.mockRejectedValue(new Error('历史列表不可用'))
    render(<ReportView />)
    await screen.findByText(/已完成 2 个/)
    expect(screen.getByRole('button', { name: '生成日报' })).toBeInTheDocument()
    expect(screen.queryByText('日报历史')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
