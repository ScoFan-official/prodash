import { renderHook, act } from '@testing-library/react'
import { useTaskTimers, subscribe } from './useTaskTimers'
import { getActiveSessions, getRecords, postTimeEvent } from '../api/client'
import { aggregateToday } from '../lib/timeStats'

const { api } = vi.hoisted(() => ({
  api: {
    getActiveSessions: vi.fn(),
    getRecords: vi.fn(),
    postTimeEvent: vi.fn(),
  },
}))

vi.mock('../api/client', () => api)

function emptySummary() {
  return {
    human: { active: false, running: false, elapsedMs: 0 },
    agent: { active: false, running: false, elapsedMs: 0 },
  }
}

function makeSession({
  taskId = 7,
  track = 'human',
  sessionStartedAt = 1000,
  accumulatedMs = 0,
  running = true,
  lastEventAt = 1000,
} = {}) {
  return { taskId, track, sessionStartedAt, accumulatedMs, running, lastEventAt }
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

// 等待 mount 恢复（microtask）完成。
async function flushRestore() {
  await act(async () => {})
}

describe('useTaskTimers（API 数据源）', () => {
  const unsubscribers = []

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    api.getActiveSessions.mockResolvedValue([])
    api.getRecords.mockResolvedValue([])
    api.postTimeEvent.mockResolvedValue({})
  })

  afterEach(() => {
    for (const unsub of unsubscribers) unsub()
    unsubscribers.length = 0
    try {
      delete document.visibilityState // 恢复 jsdom 默认值
    } catch {
      /* ignore */
    }
    vi.useRealTimers()
  })

  function track(listener) {
    unsubscribers.push(subscribe(listener))
    return listener
  }

  function setVisibility(state) {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => state,
    })
  }

  test('启动恢复：注入活跃会话与当日记录，startedAt 取 lastEventAt 并统一为数字', async () => {
    vi.setSystemTime(6000)
    api.getActiveSessions.mockResolvedValue([makeSession({ taskId: 7, lastEventAt: 1000 })])
    // 已停止记录（todoId 8，不在 active 中）正常注入；
    // 运行中会话（todoId 7）的 record 会被 I5 过滤排除，见双计回归测试。
    api.getRecords.mockResolvedValue([
      {
        id: 'r1',
        todoId: '8',
        track: 'human',
        startedAt: 1000,
        endedAt: 3000,
        durationMs: 2000,
        segments: [{ startedAt: 1000, endedAt: 3000, durationMs: 2000 }],
      },
    ])
    const { result } = renderHook(() => useTaskTimers())
    await flushRestore()

    expect(getActiveSessions).toHaveBeenCalled()
    expect(getRecords).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))

    expect(result.current.loadError).toBe(false)
    // 恢复的 active 条目：todoId 为 String(taskId)，startedAt = lastEventAt（数字）
    expect(result.current.active['7:human']).toMatchObject({
      id: 'restored-7-human',
      todoId: '7',
      track: 'human',
      startedAt: 1000,
      sessionStartedAt: 1000,
      accumulatedMs: 0,
      running: true,
    })
    // 推进系统时间后按 accumulatedMs + (now - startedAt) 显示累计时长
    expect(result.current.getTodoSummary('7').human).toEqual({
      active: true,
      running: true,
      elapsedMs: 5000,
    })
    // records 的 todoId 统一为字符串
    expect(result.current.records).toHaveLength(1)
    expect(result.current.records[0]).toMatchObject({ todoId: '8', durationMs: 2000 })
  })

  test('恢复时 ISO 字符串时间字段统一转数字（lastEventAt 转数字正确）', async () => {
    vi.setSystemTime(6000)
    const iso = '2026-08-06T01:00:00.000Z'
    api.getActiveSessions.mockResolvedValue([
      { taskId: '9', track: 'agent', sessionStartedAt: iso, accumulatedMs: 0, running: true, lastEventAt: iso },
    ])
    api.getRecords.mockResolvedValue([
      {
        id: 'r2',
        todoId: '10',
        track: 'agent',
        startedAt: iso,
        endedAt: iso,
        durationMs: 0,
        segments: [],
      },
    ])
    const { result } = renderHook(() => useTaskTimers())
    await flushRestore()

    const entry = result.current.active['9:agent']
    expect(typeof entry.startedAt).toBe('number')
    expect(entry.startedAt).toBe(Date.parse(iso))
    expect(typeof entry.sessionStartedAt).toBe('number')
    expect(result.current.records[0].startedAt).toBe(Date.parse(iso))
  })

  test('恢复失败时降级为空状态并标记 loadError', async () => {
    api.getActiveSessions.mockRejectedValue(new Error('network'))
    const { result } = renderHook(() => useTaskTimers())
    await flushRestore()

    expect(result.current.loadError).toBe(true)
    expect(result.current.active).toEqual({})
    expect(result.current.records).toEqual([])
    expect(result.current.getTodoSummary('7')).toEqual(emptySummary())
  })

  test('start/pause/resume/stop 同步 POST 对应 time-event（fire-and-forget）', async () => {
    vi.setSystemTime(1000)
    const { result } = renderHook(() => useTaskTimers())
    await flushRestore()

    act(() => result.current.start('5', 'human'))
    expect(postTimeEvent).toHaveBeenLastCalledWith({ taskId: 5, track: 'human', event: 'start', ts: 1000 })

    act(() => result.current.pause('5', 'human'))
    expect(postTimeEvent).toHaveBeenLastCalledWith({ taskId: 5, track: 'human', event: 'pause', ts: 1000 })

    act(() => result.current.resume('5', 'human'))
    expect(postTimeEvent).toHaveBeenLastCalledWith({ taskId: 5, track: 'human', event: 'resume', ts: 1000 })

    act(() => result.current.stop('5', 'human'))
    expect(postTimeEvent).toHaveBeenLastCalledWith({ taskId: 5, track: 'human', event: 'stop', ts: 1000 })
  })

  test('time-event POST 失败时 saveError 为 true 且不阻塞 UI', async () => {
    vi.setSystemTime(1000)
    api.postTimeEvent.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useTaskTimers())
    await flushRestore()

    act(() => result.current.start('5', 'human'))
    await flushRestore()
    expect(result.current.saveError).toBe(true)
    expect(result.current.getTodoSummary('5').human.running).toBe(true)
  })

  test('setInterval 触发 UI 刷新，时长随系统时间推进', async () => {
    vi.setSystemTime(1000)
    const { result } = renderHook(() => useTaskTimers())
    await flushRestore()

    act(() => result.current.start('5', 'human'))
    vi.setSystemTime(6000)
    const before = result.current
    act(() => vi.advanceTimersByTime(1000)) // 触发一次 tick
    expect(result.current).not.toBe(before) // 发生了重渲染
    expect(result.current.getTodoSummary('5').human.elapsedMs).toBe(Date.now() - 1000)
  })

  test('stop 生成记录并通过 subscribe 通知', async () => {
    vi.setSystemTime(1000)
    const listener = track(vi.fn())
    const { result } = renderHook(() => useTaskTimers())
    await flushRestore()

    act(() => result.current.start('5', 'human'))
    vi.setSystemTime(4000)
    act(() => result.current.stop('5', 'human'))
    expect(result.current.getTodoSummary('5').human).toEqual({
      active: false,
      running: false,
      elapsedMs: 0,
    })
    expect(result.current.records).toHaveLength(1)
    expect(result.current.records[0]).toMatchObject({
      todoId: '5',
      track: 'human',
      startedAt: 1000,
      endedAt: 4000,
      durationMs: 3000,
    })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0]).toMatchObject({
      type: 'stop',
      record: { todoId: '5', track: 'human', durationMs: 3000 },
    })
  })

  test('stopForTodo 停止该待办全部轨道并对每个活跃轨道各 POST 一个 stop', async () => {
    vi.setSystemTime(1000)
    const listener = track(vi.fn())
    const { result } = renderHook(() => useTaskTimers())
    await flushRestore()

    act(() => result.current.start('5', 'human'))
    act(() => result.current.start('5', 'agent'))
    postTimeEvent.mockClear()

    act(() => result.current.stopForTodo('5'))
    expect(listener).toHaveBeenCalledTimes(2)
    expect(result.current.getTodoSummary('5')).toEqual(emptySummary())
    expect(postTimeEvent).toHaveBeenCalledTimes(2)
    expect(postTimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 5, track: 'human', event: 'stop' }),
    )
    expect(postTimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 5, track: 'agent', event: 'stop' }),
    )
  })

  test('stopForTodo 对暂停中的轨道也 POST stop', async () => {
    vi.setSystemTime(1000)
    const { result } = renderHook(() => useTaskTimers())
    await flushRestore()

    act(() => result.current.start('5', 'human'))
    act(() => result.current.pause('5', 'human'))
    postTimeEvent.mockClear()

    act(() => result.current.stopForTodo('5'))
    expect(postTimeEvent).toHaveBeenCalledTimes(1)
    expect(postTimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 5, track: 'human', event: 'stop' }),
    )
  })

  test('pagehide 时对运行中条目 POST stop 并本地照常停止', async () => {
    vi.setSystemTime(1000)
    const { result } = renderHook(() => useTaskTimers())
    await flushRestore()

    act(() => result.current.start('5', 'human'))
    act(() => result.current.start('6', 'agent'))
    postTimeEvent.mockClear()

    act(() => window.dispatchEvent(new Event('pagehide')))
    expect(postTimeEvent).toHaveBeenCalledTimes(2)
    expect(postTimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 5, track: 'human', event: 'stop' }),
    )
    expect(postTimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 6, track: 'agent', event: 'stop' }),
    )
    // 本地同样停止：条目移出 active 并生成记录
    expect(result.current.getTodoSummary('5').human).toEqual({
      active: false,
      running: false,
      elapsedMs: 0,
    })
    expect(result.current.records).toHaveLength(2)
  })

  test('页面隐藏（visibilitychange hidden）时刷出 stop，回到前台只刷新不复活', async () => {
    vi.setSystemTime(1000)
    const { result } = renderHook(() => useTaskTimers())
    await flushRestore()

    act(() => result.current.start('5', 'human'))
    postTimeEvent.mockClear()

    setVisibility('hidden')
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(postTimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 5, track: 'human', event: 'stop' }),
    )

    vi.setSystemTime(6000)
    setVisibility('visible')
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    // 已本地停止，回到前台不复活
    expect(result.current.getTodoSummary('5').human.running).toBe(false)
  })

  test('恢复的运行中会话在页面隐藏时也会刷出 stop', async () => {
    api.getActiveSessions.mockResolvedValue([makeSession({ taskId: 7, lastEventAt: 1000 })])
    const { result } = renderHook(() => useTaskTimers())
    await flushRestore()

    postTimeEvent.mockClear()
    act(() => window.dispatchEvent(new Event('pagehide')))
    expect(postTimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 7, track: 'human', event: 'stop' }),
    )
  })

  test('hasRunning 与 getTodoSummary 兼容数字 id', async () => {
    const { result } = renderHook(() => useTaskTimers())
    await flushRestore()

    expect(result.current.hasRunning(42)).toBe(false)
    act(() => result.current.start(42, 'human'))
    expect(result.current.hasRunning(42)).toBe(true)
    expect(result.current.hasRunning('42')).toBe(true)
    expect(result.current.getTodoSummary(42).human).toEqual({
      active: true,
      running: true,
      elapsedMs: expect.any(Number),
    })
    act(() => result.current.pause(42, 'human'))
    expect(result.current.hasRunning(42)).toBe(false) // 暂停中的计时不阻止删除
  })

  test('恢复 last-event=pause 的暂停会话：startedAt=null、accumulatedMs 保留，继续有效', async () => {
    vi.setSystemTime(10000)
    api.getActiveSessions.mockResolvedValue([
      makeSession({
        taskId: 7,
        running: false,
        accumulatedMs: 3000,
        lastEventAt: 4000,
        sessionStartedAt: 1000,
      }),
    ])
    const { result } = renderHook(() => useTaskTimers())
    await flushRestore()

    expect(result.current.active['7:human']).toMatchObject({
      id: 'restored-7-human',
      todoId: '7',
      track: 'human',
      startedAt: null,
      accumulatedMs: 3000,
      running: false,
      sessionStartedAt: 1000,
    })
    // 暂停中按已固化累计显示时长
    expect(result.current.getTodoSummary('7').human).toEqual({
      active: true,
      running: false,
      elapsedMs: 3000,
    })
    // 继续有效：running=true、startedAt 重新开启，并 POST resume
    act(() => result.current.resume('7', 'human'))
    expect(result.current.active['7:human'].running).toBe(true)
    expect(result.current.active['7:human'].startedAt).toBe(Date.now())
    expect(postTimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 7, track: 'human', event: 'resume' }),
    )
  })

  test('restore 与用户操作竞态：restore 只补缺失 key，不覆盖用户新起的计时', async () => {
    const restoreDeferred = deferred()
    api.getActiveSessions.mockReturnValue(restoreDeferred.promise)
    api.getRecords.mockResolvedValue([])
    const { result } = renderHook(() => useTaskTimers())
    await flushRestore()

    // 恢复尚未返回时用户立刻 start
    act(() => result.current.start('1', 'human'))
    expect(result.current.active['1:human']).toBeDefined()

    // restore 随后返回另一条 running 会话
    await act(async () => {
      restoreDeferred.resolve([makeSession({ taskId: 2, running: true, lastEventAt: 1000 })])
    })

    // 用户条目保留（非 restored- 前缀），restore 补入缺失 key
    expect(result.current.active['1:human']).toBeDefined()
    expect(result.current.active['1:human'].id).not.toMatch(/^restored-/)
    expect(result.current.active['2:human']).toMatchObject({ todoId: '2', running: true })
  })

  test('I5 双计回归：running:true 记录被丢弃、segments 填充 active，聚合只计一次', async () => {
    vi.setSystemTime(6000)
    // 运行中会话：已完成段 [1000→3000)（2000ms），当前运行尾段 [4000→now)
    api.getActiveSessions.mockResolvedValue([
      {
        taskId: 7,
        track: 'human',
        sessionStartedAt: 1000,
        accumulatedMs: 2000,
        running: true,
        lastEventAt: 4000,
        segments: [{ startedAt: 1000, endedAt: 3000, durationMs: 2000 }],
      },
    ])
    // 服务端当日 records：运行中会话的记录带 running:true（含 I1-b 合成尾段）
    api.getRecords.mockResolvedValue([
      {
        id: 'r1',
        todoId: '7',
        track: 'human',
        running: true,
        startedAt: 1000,
        endedAt: 6000,
        durationMs: 4000,
        segments: [
          { startedAt: 1000, endedAt: 3000, durationMs: 2000 },
          { startedAt: 4000, endedAt: 6000, durationMs: 2000 },
        ],
      },
    ])
    const { result } = renderHook(() => useTaskTimers())
    await flushRestore()

    // records 不含 running 记录（已被丢弃）
    expect(result.current.records).toHaveLength(0)
    // active 条目 segments 已填充（已完成段），startedAt=lastEventAt 语义不变
    expect(result.current.active['7:human']).toMatchObject({
      running: true,
      startedAt: 4000,
      accumulatedMs: 2000,
      segments: [{ startedAt: 1000, endedAt: 3000, durationMs: 2000 }],
    })
    // 聚合只计一次 = active 当前时长：已完成 2000 + 当前尾段 (6000-4000)=2000 → 4000
    const stats = aggregateToday(
      { active: result.current.active, records: result.current.records },
      [{ id: '7', text: '任务甲' }],
      6000,
    )
    expect(stats.totalHumanMs).toBe(4000)
    expect(stats.totalAgentMs).toBe(0)
  })

  test('I5 暂停会话的 records 同样被排除（打开中会话由 active 单源呈现）', async () => {
    vi.setSystemTime(6000)
    api.getActiveSessions.mockResolvedValue([
      {
        taskId: 7,
        track: 'human',
        sessionStartedAt: 1000,
        accumulatedMs: 2000,
        running: false,
        lastEventAt: 3000,
        segments: [{ startedAt: 1000, endedAt: 3000, durationMs: 2000 }],
      },
    ])
    // 暂停会话在当日 records 中也有重构记录（running:false），应被 active-key 过滤排除
    api.getRecords.mockResolvedValue([
      {
        id: 'r1',
        todoId: '7',
        track: 'human',
        running: false,
        startedAt: 1000,
        endedAt: 3000,
        durationMs: 2000,
        segments: [{ startedAt: 1000, endedAt: 3000, durationMs: 2000 }],
      },
    ])
    const { result } = renderHook(() => useTaskTimers())
    await flushRestore()

    expect(result.current.records).toHaveLength(0)
    expect(result.current.active['7:human']).toMatchObject({
      running: false,
      startedAt: null,
      accumulatedMs: 2000,
      segments: [{ startedAt: 1000, endedAt: 3000, durationMs: 2000 }],
    })
  })
})
