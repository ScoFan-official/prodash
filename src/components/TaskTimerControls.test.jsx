import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TaskTimerControls, { formatMinutes } from './TaskTimerControls'

function summaryOf({ human = {}, agent = {} } = {}) {
  const idle = { active: false, running: false, elapsedMs: 0 }
  return { human: { ...idle, ...human }, agent: { ...idle, ...agent } }
}

const noop = () => {}

describe('TaskTimerControls 双轨控制', () => {
  test('未开始时显示人工/Agent 两组开始按钮', () => {
    render(
      <TaskTimerControls
        summary={summaryOf()}
        onStart={noop}
        onPause={noop}
        onResume={noop}
        onStop={noop}
      />
    )
    expect(screen.getByRole('button', { name: '开始人工计时' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始Agent计时' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '暂停人工计时' })).not.toBeInTheDocument()
  })

  test('运行中显示暂停/停止，且不再显示开始', () => {
    render(
      <TaskTimerControls
        summary={summaryOf({ human: { active: true, running: true, elapsedMs: 60000 } })}
        onStart={noop}
        onPause={noop}
        onResume={noop}
        onStop={noop}
      />
    )
    expect(screen.getByRole('button', { name: '暂停人工计时' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '停止人工计时' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '开始人工计时' })).not.toBeInTheDocument()
  })

  test('暂停中显示继续/停止', () => {
    render(
      <TaskTimerControls
        summary={summaryOf({ human: { active: true, running: false, elapsedMs: 120000 } })}
        onStart={noop}
        onPause={noop}
        onResume={noop}
        onStop={noop}
      />
    )
    expect(screen.getByRole('button', { name: '继续人工计时' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '停止人工计时' })).toBeInTheDocument()
  })

  test('累计时长按分钟显示（向下取整）', () => {
    render(
      <TaskTimerControls
        summary={summaryOf({
          human: { active: true, running: true, elapsedMs: 150000 },
          agent: { active: true, running: true, elapsedMs: 60000 },
        })}
        onStart={noop}
        onPause={noop}
        onResume={noop}
        onStop={noop}
      />
    )
    expect(screen.getByText('2 分钟')).toBeInTheDocument()
    expect(screen.getByText('1 分钟')).toBeInTheDocument()
    expect(formatMinutes(0)).toBe(0)
    expect(formatMinutes(59999)).toBe(0)
    expect(formatMinutes(120000)).toBe(2)
  })

  test('点击暂停/停止回调对应轨道', async () => {
    const user = userEvent.setup()
    const onPause = vi.fn()
    const onStop = vi.fn()
    render(
      <TaskTimerControls
        summary={summaryOf({
          human: { active: true, running: true, elapsedMs: 60000 },
          agent: { active: true, running: true, elapsedMs: 60000 },
        })}
        onStart={vi.fn()}
        onPause={onPause}
        onResume={vi.fn()}
        onStop={onStop}
      />
    )
    await user.click(screen.getByRole('button', { name: '暂停人工计时' }))
    expect(onPause).toHaveBeenCalledWith('human')
    await user.click(screen.getByRole('button', { name: '停止Agent计时' }))
    expect(onStop).toHaveBeenCalledWith('agent')
  })

  test('disabled 时只禁用开始/继续，保留暂停和停止', () => {
    render(
      <TaskTimerControls
        summary={summaryOf({
          human: { active: true, running: true, elapsedMs: 60000 },
          agent: { active: true, running: false, elapsedMs: 30000 },
        })}
        onStart={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onStop={vi.fn()}
        disabled
      />
    )
    expect(screen.getByRole('button', { name: '暂停人工计时' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: '停止人工计时' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: '继续Agent计时' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '停止Agent计时' })).not.toBeDisabled()
  })
})
