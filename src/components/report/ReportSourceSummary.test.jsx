import { render, screen } from '@testing-library/react'
import ReportSourceSummary from './ReportSourceSummary'

it('展示钉钉来源任务数量', () => {
  const source = {
    completedTodos: [{ id: 1, source: 'dingtalk' }, { id: 2, source: 'local' }],
    pendingTodos: [{ id: 3, source: 'dingtalk' }],
    totalHumanMs: 0,
    totalAgentMs: 0,
  }
  render(<ReportSourceSummary source={source} />)
  expect(screen.getByText('含钉钉任务 2 条')).toBeInTheDocument()
})

it('无钉钉任务时不显示统计', () => {
  const source = {
    completedTodos: [],
    pendingTodos: [{ id: 1, source: 'local' }],
    totalHumanMs: 0,
    totalAgentMs: 0,
  }
  render(<ReportSourceSummary source={source} />)
  expect(screen.queryByText(/含钉钉任务/)).not.toBeInTheDocument()
})
