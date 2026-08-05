import { aggregateToday, formatDuration, formatDurationShort, percent, formatPercent } from './timeStats'
import { DELETED_TODO_LABEL } from './timeStore'

function makeDate(y, m, d, h = 0) {
  return new Date(y, m, d, h).getTime()
}

function segment(startedAt, durationMs) {
  return { startedAt, endedAt: startedAt + durationMs, durationMs }
}

function record(todoId, track, segments) {
  const totalMs = segments.reduce((sum, s) => sum + s.durationMs, 0)
  const startedAt = segments[0]?.startedAt ?? 0
  const endedAt = segments[segments.length - 1]?.endedAt ?? startedAt
  return {
    id: `${todoId}-${track}-${startedAt}`,
    todoId,
    track,
    startedAt,
    endedAt,
    durationMs: totalMs,
    segments,
  }
}

describe('timeStats 工时统计', () => {
  const today = makeDate(2026, 7, 5, 10)
  const yesterday = makeDate(2026, 7, 4, 10)

  const todos = [
    { id: 't1', text: '任务甲', important: true, urgent: true },
    { id: 't2', text: '任务乙', important: false, urgent: true },
    { id: 't3', text: '任务丙', important: true, urgent: false },
  ]

  test('空数据返回稳定零值', () => {
    const stats = aggregateToday([], [], today)
    expect(stats).toEqual({
      date: '2026-08-05',
      totalHumanMs: 0,
      totalAgentMs: 0,
      totalMs: 0,
      byTask: [],
      byCategory: [],
    })
    expect(formatDuration(0)).toBe('0 分钟')
    expect(formatPercent(0, 0)).toBe('0%')
  })

  test('单个人工记录汇总', () => {
    const stats = aggregateToday(
      [record('t1', 'human', [segment(today, 2 * 3600_000)])],
      todos,
      today,
    )
    expect(stats.totalHumanMs).toBe(2 * 3600_000)
    expect(stats.totalAgentMs).toBe(0)
    expect(stats.totalMs).toBe(2 * 3600_000)
    expect(stats.byTask).toHaveLength(1)
    expect(stats.byTask[0]).toMatchObject({
      todoId: 't1',
      title: '任务甲',
      humanMs: 2 * 3600_000,
      agentMs: 0,
      totalMs: 2 * 3600_000,
    })
    expect(stats.byCategory[0]).toMatchObject({
      key: 'important-urgent',
      label: '重要·紧急',
      totalMs: 2 * 3600_000,
    })
  })

  test('人工与 Agent 时长分别累计并计算占比', () => {
    const stats = aggregateToday(
      [
        record('t1', 'human', [segment(today, 3 * 3600_000)]),
        record('t1', 'agent', [segment(today, 1 * 3600_000)]),
        record('t2', 'human', [segment(today, 2 * 3600_000)]),
      ],
      todos,
      today,
    )
    expect(stats.totalHumanMs).toBe(5 * 3600_000)
    expect(stats.totalAgentMs).toBe(1 * 3600_000)
    expect(stats.totalMs).toBe(6 * 3600_000)
    expect(percent(stats.totalHumanMs, stats.totalMs)).toBeCloseTo(83.3, 1)
    expect(percent(stats.totalAgentMs, stats.totalMs)).toBeCloseTo(16.7, 1)
  })

  test('按任务排行按总时长降序', () => {
    const stats = aggregateToday(
      [
        record('t3', 'human', [segment(today, 30 * 60_000)]),
        record('t1', 'human', [segment(today, 2 * 3600_000)]),
        record('t1', 'agent', [segment(today, 1 * 3600_000)]),
        record('t2', 'human', [segment(today, 45 * 60_000)]),
      ],
      todos,
      today,
    )
    expect(stats.byTask.map((t) => t.todoId)).toEqual(['t1', 't2', 't3'])
    expect(stats.byTask[0].title).toBe('任务甲')
    expect(stats.byTask[0].totalMs).toBe(3 * 3600_000)
  })

  test('按任务四象限分类占比', () => {
    const stats = aggregateToday(
      [
        record('t1', 'human', [segment(today, 2 * 3600_000)]),
        record('t2', 'human', [segment(today, 1 * 3600_000)]),
        record('t3', 'human', [segment(today, 1 * 3600_000)]),
      ],
      todos,
      today,
    )
    expect(stats.byCategory).toHaveLength(3)
    const cat = (key) => stats.byCategory.find((c) => c.key === key)
    expect(cat('important-urgent').totalMs).toBe(2 * 3600_000)
    expect(cat('not-important-urgent').totalMs).toBe(1 * 3600_000)
    expect(cat('important-not-urgent').totalMs).toBe(1 * 3600_000)
  })

  test('孤立记录显示「已删除任务」', () => {
    const stats = aggregateToday(
      [record('gone', 'human', [segment(today, 25 * 60_000)])],
      todos,
      today,
    )
    expect(stats.byTask[0].title).toBe(DELETED_TODO_LABEL)
    expect(stats.byCategory[0].label).toBe(DELETED_TODO_LABEL)
    expect(stats.byCategory[0].key).toBe('deleted')
  })

  test('非今日 segment 不计入', () => {
    const stats = aggregateToday(
      [
        record('t1', 'human', [
          segment(yesterday, 2 * 3600_000),
          segment(today, 1 * 3600_000),
        ]),
      ],
      todos,
      today,
    )
    expect(stats.totalHumanMs).toBe(1 * 3600_000)
    expect(stats.byTask[0].totalMs).toBe(1 * 3600_000)
  })

  test('非法 segment 不导致崩溃', () => {
    const stats = aggregateToday(
      [
        { todoId: 't1', track: 'human', segments: [{ startedAt: NaN, durationMs: 1000 }] },
        { todoId: 't1', track: 'human', segments: null },
        record('t1', 'human', [segment(today, 30 * 60_000)]),
      ],
      todos,
      today,
    )
    expect(stats.totalHumanMs).toBe(30 * 60_000)
  })

  test('formatDuration 格式化小时与分钟', () => {
    expect(formatDuration(0)).toBe('0 分钟')
    expect(formatDuration(59_999)).toBe('0 分钟')
    expect(formatDuration(60_000)).toBe('1 分钟')
    expect(formatDuration(90_000)).toBe('1 分钟')
    expect(formatDuration(2 * 3600_000)).toBe('2 小时')
    expect(formatDuration(2 * 3600_000 + 30 * 60_000)).toBe('2 小时 30 分钟')
    expect(formatDurationShort(90 * 60_000)).toBe('1h30m')
  })

  test('formatPercent 保留一位小数', () => {
    expect(formatPercent(1, 3)).toBe('33.3%')
    expect(formatPercent(2, 3)).toBe('66.7%')
    expect(formatPercent(0, 0)).toBe('0%')
  })
})
