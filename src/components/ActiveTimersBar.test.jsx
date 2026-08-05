import { render, screen, fireEvent } from '@testing-library/react'
import ActiveTimersBar from './ActiveTimersBar'

function makeEntry(todoId, track, { running = true, startedAt = 1000, accumulatedMs = 0 } = {}) {
  return {
    id: `${todoId}-${track}-${startedAt}`,
    todoId,
    track,
    running,
    startedAt: running ? startedAt : null,
    accumulatedMs,
    sessionStartedAt: startedAt,
    segments: [],
  }
}

const todos = [
  { id: 't1', text: '任务甲' },
  { id: 't2', text: '任务乙' },
  { id: 't3', text: '任务丙' },
]

describe('ActiveTimersBar 顶部活动计时条', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(120_000)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('无计时任务时显示空状态', () => {
    render(<ActiveTimersBar active={{}} todos={todos} />)
    expect(screen.getByText('暂无计时任务')).toBeInTheDocument()
  })

  test('折叠态显示正在计时数量与任务名称', () => {
    const active = {
      't1:human': makeEntry('t1', 'human', { startedAt: 0 }),
      't2:agent': makeEntry('t2', 'agent', { startedAt: 0 }),
    }
    render(<ActiveTimersBar active={active} todos={todos} />)
    expect(screen.getByText('2 个任务正在计时')).toBeInTheDocument()
    expect(screen.getByText(/任务甲/)).toBeInTheDocument()
  })

  test('点击展开后显示轨道与累计时长，再次点击收起', () => {
    const active = {
      't1:human': makeEntry('t1', 'human', { startedAt: 0 }),
    }
    render(<ActiveTimersBar active={active} todos={todos} />)
    const summary = screen.getByRole('button', { name: '展开计时详情' })
    expect(screen.queryByText('人工')).not.toBeInTheDocument()

    fireEvent.click(summary)
    expect(screen.getByText('人工')).toBeInTheDocument()
    expect(screen.getByText('2 分钟')).toBeInTheDocument()

    fireEvent.click(summary)
    expect(screen.queryByText('人工')).not.toBeInTheDocument()
  })

  test('暂停中的任务在展开后显示', () => {
    const active = {
      't1:human': makeEntry('t1', 'human', { running: false, startedAt: 0, accumulatedMs: 60_000 }),
    }
    render(<ActiveTimersBar active={active} todos={todos} />)
    expect(screen.getByText('0 个任务正在计时')).toBeInTheDocument()
    expect(screen.getByText('，1 个暂停')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '展开计时详情' }))
    expect(screen.getByText('人工')).toBeInTheDocument()
    expect(screen.getByText('1 分钟')).toBeInTheDocument()
  })

  test('点击停止按钮调用 onStop(todoId, track)', () => {
    const onStop = vi.fn()
    const active = {
      't1:human': makeEntry('t1', 'human', { startedAt: 0 }),
      't2:agent': makeEntry('t2', 'agent', { startedAt: 0 }),
    }
    render(<ActiveTimersBar active={active} todos={todos} onStop={onStop} />)
    fireEvent.click(screen.getByRole('button', { name: '展开计时详情' }))
    fireEvent.click(screen.getByRole('button', { name: '停止 任务甲 的人工计时' }))
    expect(onStop).toHaveBeenCalledWith('t1', 'human')
  })

  test('已删除任务显示默认名称', () => {
    const active = {
      'gone:human': makeEntry('gone', 'human', { startedAt: 0 }),
    }
    render(<ActiveTimersBar active={active} todos={todos} />)
    expect(screen.getByText(/已删除任务/)).toBeInTheDocument()
  })
})
