import { render, screen } from '@testing-library/react'
import TimeStatsView from './TimeStatsView'

function segment(startedAt, durationMs) {
  return { startedAt, endedAt: startedAt + durationMs, durationMs }
}

function record(todoId, track, segments) {
  const totalMs = segments.reduce((sum, s) => sum + s.durationMs, 0)
  return {
    id: `${todoId}-${track}`,
    todoId,
    track,
    startedAt: segments[0].startedAt,
    endedAt: segments[segments.length - 1].endedAt,
    durationMs: totalMs,
    segments,
  }
}

describe('TimeStatsView 统计视图', () => {
  const today = new Date(2026, 7, 5, 12, 0, 0).getTime()
  const todos = [
    { id: 't1', text: '任务甲', important: true, urgent: true },
    { id: 't2', text: '任务乙', important: false, urgent: true },
    { id: 't3', text: '任务丙', important: true, urgent: false },
  ]

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(today)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('展示今日人工、Agent汇总与占比', () => {
    const records = [
      record('t1', 'human', [segment(today - 2 * 3600_000, 2 * 3600_000)]),
      record('t1', 'agent', [segment(today - 1 * 3600_000, 1 * 3600_000)]),
      record('t2', 'human', [segment(today - 30 * 60_000, 30 * 60_000)]),
    ]
    render(<TimeStatsView records={records} todos={todos} />)
    expect(screen.getByText('今日工时统计')).toBeInTheDocument()
    expect(screen.getByText('2026-08-05')).toBeInTheDocument()
    expect(screen.getByText('2 小时 30 分钟')).toBeInTheDocument()
    expect(screen.getByText('1 小时')).toBeInTheDocument()
    expect(screen.getByText('3 小时 30 分钟')).toBeInTheDocument()
    expect(screen.getByText('71.4%')).toBeInTheDocument()
    expect(screen.getByText('28.6%')).toBeInTheDocument()
  })

  test('按任务排行显示任务名称与时长', () => {
    const records = [
      record('t1', 'human', [segment(today, 2 * 3600_000)]),
      record('t1', 'agent', [segment(today, 1 * 3600_000)]),
      record('t2', 'human', [segment(today, 45 * 60_000)]),
    ]
    render(<TimeStatsView records={records} todos={todos} />)
    expect(screen.getByText('任务甲')).toBeInTheDocument()
    expect(screen.getByText('任务乙')).toBeInTheDocument()
    const ranks = screen.getAllByText(/^[123]$/)
    expect(ranks).toHaveLength(2)
  })

  test('按任务分类占比显示饼图与图例', () => {
    const records = [
      record('t1', 'human', [segment(today, 1 * 3600_000)]),
      record('t2', 'human', [segment(today, 1 * 3600_000)]),
    ]
    render(<TimeStatsView records={records} todos={todos} />)
    expect(screen.getByRole('img', { name: '按任务分类占比' })).toBeInTheDocument()
    expect(screen.getByText('重要·紧急')).toBeInTheDocument()
    expect(screen.getByText('不重要·紧急')).toBeInTheDocument()
  })

  test('空数据时显示无数据提示', () => {
    render(<TimeStatsView records={[]} todos={todos} />)
    expect(screen.getByText('今日暂无工时记录')).toBeInTheDocument()
    expect(screen.getByText('今日暂无分类数据')).toBeInTheDocument()
  })
})
