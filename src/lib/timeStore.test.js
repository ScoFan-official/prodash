import {
  createInitialState,
  startTimer,
  pauseTimer,
  resumeTimer,
  stopTimer,
  getElapsedMs,
  hasRunningTimerForTodo,
  stopTimersForTodo,
  subscribe,
} from './timeStore'

describe('timeStore 计时领域模块', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('createInitialState 返回空状态', () => {
    expect(createInitialState()).toEqual({ active: {}, records: [] })
  })

  test('startTimer 启动人工计时', () => {
    const state = startTimer(createInitialState(), 't1', 'human', 1000)
    const entry = state.active['t1:human']
    expect(entry).toMatchObject({
      todoId: 't1',
      track: 'human',
      startedAt: 1000,
      accumulatedMs: 0,
      running: true,
      sessionStartedAt: 1000,
      segments: [],
    })
  })

  test('startTimer 启动 Agent 计时', () => {
    const state = startTimer(createInitialState(), 't1', 'agent', 2000)
    expect(state.active['t1:agent']).toMatchObject({
      todoId: 't1',
      track: 'agent',
      running: true,
    })
  })

  test('同一待办可 human 与 agent 两轨并行', () => {
    let s = createInitialState()
    s = startTimer(s, 't1', 'human', 1000)
    s = startTimer(s, 't1', 'agent', 2000)
    expect(Object.keys(s.active).sort()).toEqual(['t1:agent', 't1:human'])
  })

  test('多个待办可并行计时，无 slot 上限', () => {
    let s = createInitialState()
    s = startTimer(s, 't1', 'human', 1000)
    s = startTimer(s, 't2', 'human', 1500)
    s = startTimer(s, 't1', 'agent', 2000)
    s = startTimer(s, 't3', 'agent', 2500)
    expect(Object.keys(s.active).sort()).toEqual([
      't1:agent',
      't1:human',
      't2:human',
      't3:agent',
    ])
  })

  test('startTimer 对已存在 key 为空操作（保持引用不变）', () => {
    let s = startTimer(createInitialState(), 't1', 'human', 1000)
    expect(startTimer(s, 't1', 'human', 9000)).toBe(s)
    s = pauseTimer(s, 't1:human', 2000)
    expect(startTimer(s, 't1', 'human', 9000)).toBe(s)
  })

  test('getElapsedMs 返回运行中已累计时长', () => {
    const s = startTimer(createInitialState(), 't1', 'human', 1000)
    expect(getElapsedMs(s.active['t1:human'], 5000)).toBe(4000)
  })

  test('getElapsedMs 暂停后返回固化累计值', () => {
    let s = startTimer(createInitialState(), 't1', 'human', 1000)
    s = pauseTimer(s, 't1:human', 3000)
    expect(getElapsedMs(s.active['t1:human'], 9000)).toBe(2000)
  })

  test('系统时间前拨时 getElapsedMs 不为负数', () => {
    const s = startTimer(createInitialState(), 't1', 'human', 5000)
    expect(getElapsedMs(s.active['t1:human'], 1000)).toBe(0)
  })

  test('pauseTimer 固化 segment 并累计时长', () => {
    let s = startTimer(createInitialState(), 't1', 'human', 1000)
    s = pauseTimer(s, 't1:human', 4000)
    const e = s.active['t1:human']
    expect(e.running).toBe(false)
    expect(e.startedAt).toBe(null)
    expect(e.accumulatedMs).toBe(3000)
    expect(e.segments).toEqual([{ startedAt: 1000, endedAt: 4000, durationMs: 3000 }])
  })

  test('pauseTimer 时间回拨时 segment 时长钳制为 0', () => {
    let s = startTimer(createInitialState(), 't1', 'human', 5000)
    s = pauseTimer(s, 't1:human', 2000)
    expect(s.active['t1:human'].accumulatedMs).toBe(0)
    expect(s.active['t1:human'].segments).toEqual([
      { startedAt: 5000, endedAt: 2000, durationMs: 0 },
    ])
  })

  test('pauseTimer 对非运行或缺失 key 为空操作', () => {
    let s = startTimer(createInitialState(), 't1', 'human', 1000)
    s = pauseTimer(s, 't1:human', 2000)
    expect(pauseTimer(s, 't1:human', 3000)).toBe(s)
    expect(pauseTimer(s, 't1:agent', 3000)).toBe(s)
  })

  test('resumeTimer 恢复运行并从新起点累计', () => {
    let s = startTimer(createInitialState(), 't1', 'human', 1000)
    s = pauseTimer(s, 't1:human', 4000)
    s = resumeTimer(s, 't1:human', 6000)
    const e = s.active['t1:human']
    expect(e.running).toBe(true)
    expect(e.startedAt).toBe(6000)
    expect(getElapsedMs(e, 7000)).toBe(4000) // 已固化 3000 + 新段 1000
  })

  test('resumeTimer 对运行中或缺失 key 为空操作', () => {
    let s = startTimer(createInitialState(), 't1', 'human', 1000)
    expect(resumeTimer(s, 't1:human', 2000)).toBe(s)
    expect(resumeTimer(s, 't1:agent', 2000)).toBe(s)
  })

  test('stopTimer 停止运行中的计时并生成完整记录', () => {
    let s = startTimer(createInitialState(), 't1', 'human', 1000)
    s = stopTimer(s, 't1:human', 5000)
    expect(s.active['t1:human']).toBeUndefined()
    expect(s.records).toHaveLength(1)
    expect(s.records[0]).toMatchObject({
      todoId: 't1',
      track: 'human',
      startedAt: 1000,
      endedAt: 5000,
      durationMs: 4000,
    })
    expect(s.records[0].segments).toEqual([
      { startedAt: 1000, endedAt: 5000, durationMs: 4000 },
    ])
  })

  test('stopTimer 停止暂停中的计时，segments 保持已固化内容', () => {
    let s = startTimer(createInitialState(), 't1', 'human', 1000)
    s = pauseTimer(s, 't1:human', 4000)
    s = stopTimer(s, 't1:human', 6000)
    expect(s.records).toHaveLength(1)
    expect(s.records[0]).toMatchObject({ startedAt: 1000, endedAt: 6000, durationMs: 3000 })
    expect(s.records[0].segments).toEqual([
      { startedAt: 1000, endedAt: 4000, durationMs: 3000 },
    ])
  })

  test('暂停→继续→停止生成多段 segments 且时长正确', () => {
    let s = createInitialState()
    s = startTimer(s, 't1', 'human', 1000)
    s = pauseTimer(s, 't1:human', 4000)
    s = resumeTimer(s, 't1:human', 6000)
    s = stopTimer(s, 't1:human', 8000)
    const r = s.records[0]
    expect(r.durationMs).toBe(5000)
    expect(r.segments).toEqual([
      { startedAt: 1000, endedAt: 4000, durationMs: 3000 },
      { startedAt: 6000, endedAt: 8000, durationMs: 2000 },
    ])
  })

  test('stopTimer 对缺失 key 为空操作', () => {
    const s = createInitialState()
    expect(stopTimer(s, 't1:human', 1000)).toBe(s)
  })

  test('hasRunningTimerForTodo 仅当存在运行中计时时返回 true', () => {
    let s = startTimer(createInitialState(), 't1', 'human', 1000)
    expect(hasRunningTimerForTodo(s, 't1')).toBe(true)
    expect(hasRunningTimerForTodo(s, 't2')).toBe(false)
    s = pauseTimer(s, 't1:human', 2000)
    expect(hasRunningTimerForTodo(s, 't1')).toBe(false)
    s = resumeTimer(s, 't1:human', 3000)
    expect(hasRunningTimerForTodo(s, 't1')).toBe(true)
  })

  test('stopTimersForTodo 停止该待办全部轨道并生成记录，不影响其他待办', () => {
    let s = createInitialState()
    s = startTimer(s, 't1', 'human', 1000)
    s = startTimer(s, 't1', 'agent', 1500)
    s = startTimer(s, 't2', 'human', 2000)
    s = stopTimersForTodo(s, 't1', 5000)
    expect(s.active['t1:human']).toBeUndefined()
    expect(s.active['t1:agent']).toBeUndefined()
    expect(s.active['t2:human']).toBeDefined()
    expect(s.records).toHaveLength(2)
    expect(s.records.every((r) => r.todoId === 't1')).toBe(true)
    const human = s.records.find((r) => r.track === 'human')
    const agent = s.records.find((r) => r.track === 'agent')
    expect(human.durationMs).toBe(4000)
    expect(agent.durationMs).toBe(3500)
  })

  test('stopTimersForTodo 也会停止暂停中的计时', () => {
    let s = createInitialState()
    s = startTimer(s, 't1', 'human', 1000)
    s = pauseTimer(s, 't1:human', 3000)
    s = stopTimersForTodo(s, 't1', 4000)
    expect(s.active['t1:human']).toBeUndefined()
    expect(s.records).toHaveLength(1)
    expect(s.records[0].durationMs).toBe(2000)
  })

  test('stopTimersForTodo 无相关计时时为空操作', () => {
    const s = createInitialState()
    expect(stopTimersForTodo(s, 't1', 1000)).toBe(s)
  })

  test('subscribe 在停止时通知，unsubscribe 后不再通知', () => {
    const listener = vi.fn()
    const unsubscribe = subscribe(listener)
    let s = createInitialState()
    s = startTimer(s, 't1', 'human', 1000)
    s = stopTimer(s, 't1:human', 5000)
    expect(listener).toHaveBeenCalledTimes(1)
    const event = listener.mock.calls[0][0]
    expect(event.type).toBe('stop')
    expect(event.record).toMatchObject({ todoId: 't1', durationMs: 4000 })

    listener.mockClear()
    unsubscribe()
    s = startTimer(s, 't2', 'agent', 6000)
    s = stopTimer(s, 't2:agent', 9000)
    expect(listener).not.toHaveBeenCalled()
  })

  test('stopTimersForTodo 为每个停止的计时发送通知', () => {
    const listener = vi.fn()
    const unsubscribe = subscribe(listener)
    let s = createInitialState()
    s = startTimer(s, 't1', 'human', 1000)
    s = startTimer(s, 't1', 'agent', 1000)
    s = stopTimersForTodo(s, 't1', 3000)
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  test('vi.setSystemTime 推进系统时间驱动运行时长', () => {
    vi.setSystemTime(1000)
    const s = startTimer(createInitialState(), 't1', 'human', Date.now())
    vi.setSystemTime(6000)
    expect(getElapsedMs(s.active['t1:human'], Date.now())).toBe(5000)
  })
})
