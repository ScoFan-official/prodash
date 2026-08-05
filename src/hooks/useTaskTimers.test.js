import { renderHook, act } from '@testing-library/react'
import { useTaskTimers, subscribe, TIMING_STORAGE_KEY } from './useTaskTimers'

function makeActiveEntry({
  track = 'human',
  startedAt,
  accumulatedMs = 0,
  running = true,
  sessionStartedAt,
}) {
  return {
    id: `id-${track}-${startedAt}`,
    todoId: 't1',
    track,
    startedAt: running ? startedAt : null,
    accumulatedMs,
    running,
    sessionStartedAt: sessionStartedAt ?? startedAt,
    segments: [],
  }
}

function emptySummary() {
  return {
    human: { active: false, running: false, elapsedMs: 0 },
    agent: { active: false, running: false, elapsedMs: 0 },
  }
}

describe('useTaskTimers', () => {
  const unsubscribers = []

  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
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

  test('从 localStorage 恢复运行状态，推进系统时间后显示累计时长', () => {
    window.localStorage.setItem(
      TIMING_STORAGE_KEY,
      JSON.stringify({
        active: { 't1:human': makeActiveEntry({ track: 'human', startedAt: 1000 }) },
        records: [],
      }),
    )
    vi.setSystemTime(6000)
    const { result } = renderHook(() => useTaskTimers())
    expect(result.current.getTodoSummary('t1').human).toEqual({
      active: true,
      running: true,
      elapsedMs: 5000,
    })
    expect(result.current.loadError).toBe(false)
  })

  test('setInterval 触发 UI 刷新，时长随系统时间推进', () => {
    vi.setSystemTime(1000)
    const { result } = renderHook(() => useTaskTimers())
    act(() => result.current.start('t1', 'human'))
    vi.setSystemTime(6000)
    const before = result.current
    act(() => vi.advanceTimersByTime(1000)) // 触发一次 tick
    expect(result.current).not.toBe(before) // 发生了重渲染
    const expectedNow = Date.now()
    expect(result.current.getTodoSummary('t1').human.elapsedMs).toBe(expectedNow - 1000)
  })

  test('人工和 Agent 同时运行且互不影响', () => {
    vi.setSystemTime(1000)
    const { result } = renderHook(() => useTaskTimers())
    act(() => result.current.start('t1', 'human'))
    act(() => result.current.start('t1', 'agent'))
    vi.setSystemTime(5000)
    expect(result.current.getTodoSummary('t1')).toEqual({
      human: { active: true, running: true, elapsedMs: 4000 },
      agent: { active: true, running: true, elapsedMs: 4000 },
    })
    // 只暂停人工，Agent 继续
    act(() => result.current.pause('t1', 'human'))
    vi.setSystemTime(7000)
    expect(result.current.getTodoSummary('t1').human.elapsedMs).toBe(4000)
    expect(result.current.getTodoSummary('t1').agent.elapsedMs).toBe(6000)
    // 恢复人工后继续累计
    act(() => result.current.resume('t1', 'human'))
    vi.setSystemTime(8000)
    expect(result.current.getTodoSummary('t1').human.elapsedMs).toBe(5000)
  })

  test('stop 生成记录并持久化到快照', () => {
    vi.setSystemTime(1000)
    const { result } = renderHook(() => useTaskTimers())
    act(() => result.current.start('t1', 'human'))
    vi.setSystemTime(4000)
    act(() => result.current.stop('t1', 'human'))
    expect(result.current.getTodoSummary('t1').human).toEqual({
      active: false,
      running: false,
      elapsedMs: 0,
    })
    const snapshot = JSON.parse(window.localStorage.getItem(TIMING_STORAGE_KEY))
    expect(snapshot.active).toEqual({})
    expect(snapshot.records).toHaveLength(1)
    expect(snapshot.records[0]).toMatchObject({
      todoId: 't1',
      track: 'human',
      startedAt: 1000,
      endedAt: 4000,
      durationMs: 3000,
    })
  })

  test('仅在开始/暂停/继续/停止时写入 localStorage，tick 不写入', () => {
    vi.setSystemTime(1000)
    const spy = vi.spyOn(Storage.prototype, 'setItem')
    const { result } = renderHook(() => useTaskTimers())
    expect(spy).not.toHaveBeenCalled() // 挂载不写入
    act(() => result.current.start('t1', 'human'))
    expect(spy).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(5000)) // 多个 tick
    expect(spy).toHaveBeenCalledTimes(1) // tick 不触发持久化
    act(() => result.current.pause('t1', 'human'))
    expect(spy).toHaveBeenCalledTimes(2)
    act(() => result.current.resume('t1', 'human'))
    expect(spy).toHaveBeenCalledTimes(3)
    act(() => result.current.stop('t1', 'human'))
    expect(spy).toHaveBeenCalledTimes(4)
    spy.mockRestore()
  })

  test('重复 start / 无效 pause 为空操作，不触发写入', () => {
    vi.setSystemTime(1000)
    const spy = vi.spyOn(Storage.prototype, 'setItem')
    const { result } = renderHook(() => useTaskTimers())
    act(() => result.current.start('t1', 'human'))
    spy.mockClear()
    act(() => result.current.start('t1', 'human')) // 已存在 → 空操作
    expect(spy).not.toHaveBeenCalled()
    act(() => result.current.pause('t1', 'agent')) // 缺失 key → 空操作
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  test('localStorage 写入失败（quota）时 saveError 为 true 且不崩溃', () => {
    vi.setSystemTime(1000)
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('quota exceeded')
      })
    const { result } = renderHook(() => useTaskTimers())
    act(() => result.current.start('t1', 'human'))
    expect(result.current.saveError).toBe(true)
    vi.setSystemTime(5000)
    expect(result.current.getTodoSummary('t1').human.elapsedMs).toBe(4000) // 内存状态不受影响
    spy.mockRestore()
  })

  test('损坏 JSON 降级为空状态并标记 loadError', () => {
    window.localStorage.setItem(TIMING_STORAGE_KEY, '{bad json')
    const { result } = renderHook(() => useTaskTimers())
    expect(result.current.loadError).toBe(true)
    expect(result.current.getTodoSummary('t1')).toEqual(emptySummary())
  })

  test('结构非法的快照降级为空状态', () => {
    window.localStorage.setItem(
      TIMING_STORAGE_KEY,
      JSON.stringify({ active: 'oops', records: null }),
    )
    const { result } = renderHook(() => useTaskTimers())
    expect(result.current.loadError).toBe(true)
    expect(result.current.hasRunning('t1')).toBe(false)
  })

  test('localStorage 读取失败时降级为空状态', () => {
    const spy = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('access denied')
      })
    const { result } = renderHook(() => useTaskTimers())
    expect(result.current.loadError).toBe(true)
    expect(result.current.hasRunning('t1')).toBe(false)
    spy.mockRestore()
  })

  test('页面隐藏时持久化快照，回到前台立即刷新', () => {
    vi.setSystemTime(1000)
    const spy = vi.spyOn(Storage.prototype, 'setItem')
    const { result } = renderHook(() => useTaskTimers())
    act(() => result.current.start('t1', 'human'))
    spy.mockClear()

    setVisibility('hidden')
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(spy).toHaveBeenCalledTimes(1) // 隐藏时写入快照

    vi.setSystemTime(6000)
    setVisibility('visible')
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(result.current.getTodoSummary('t1').human.elapsedMs).toBe(5000) // 回前台立即刷新
    spy.mockRestore()
  })

  test('pagehide 时持久化快照', () => {
    vi.setSystemTime(1000)
    const spy = vi.spyOn(Storage.prototype, 'setItem')
    const { result } = renderHook(() => useTaskTimers())
    act(() => result.current.start('t1', 'human'))
    spy.mockClear()
    act(() => window.dispatchEvent(new Event('pagehide')))
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  test('暴露 subscribe 注册点，停止事件含完整 record', () => {
    vi.setSystemTime(1000)
    const listener = track(vi.fn())
    const { result } = renderHook(() => useTaskTimers())
    act(() => result.current.start('t1', 'human'))
    vi.setSystemTime(3000)
    act(() => result.current.stop('t1', 'human'))
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0]).toMatchObject({
      type: 'stop',
      record: { todoId: 't1', track: 'human', durationMs: 2000 },
    })
  })

  test('stopForTodo 停止该待办全部轨道并逐个通知', () => {
    vi.setSystemTime(1000)
    const listener = track(vi.fn())
    const { result } = renderHook(() => useTaskTimers())
    act(() => result.current.start('t1', 'human'))
    act(() => result.current.start('t1', 'agent'))
    act(() => result.current.stopForTodo('t1'))
    expect(listener).toHaveBeenCalledTimes(2)
    expect(result.current.getTodoSummary('t1')).toEqual(emptySummary())
  })

  test('hasRunning 仅反映运行中计时（删除保护语义）', () => {
    vi.setSystemTime(1000)
    const { result } = renderHook(() => useTaskTimers())
    expect(result.current.hasRunning('t1')).toBe(false)
    act(() => result.current.start('t1', 'human'))
    expect(result.current.hasRunning('t1')).toBe(true)
    act(() => result.current.pause('t1', 'human'))
    expect(result.current.hasRunning('t1')).toBe(false)
    act(() => result.current.resume('t1', 'human'))
    expect(result.current.hasRunning('t1')).toBe(true)
    act(() => result.current.stop('t1', 'human'))
    expect(result.current.hasRunning('t1')).toBe(false)
  })
})
