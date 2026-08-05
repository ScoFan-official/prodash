// React 计时 hook：将纯领域模块 timeStore 绑定到 React 状态与 localStorage 持久化。
//
// 职责边界：
//   - 领域逻辑（开始/暂停/继续/停止/记录/停止事件）全部委托给 ../lib/timeStore 的纯函数；
//   - 本文件只负责快照读写与降级（读/写失败不崩溃）、低频持久化、tick 刷新与页面可见性刷新。
//
// 持久化策略（key: prodash.time-tracking.v1，与计划数据契约一致）：
//   - 仅在 start / pause / resume / stop / stopForTodo 及页面隐藏（visibilitychange/pagehide）时写快照；
//   - setInterval 只触发 UI 刷新，所有时长在渲染时用 Date.now() 计算，绝不在每个 tick 写 localStorage；
//   - 运行中条目保存绝对 startedAt，恢复后按 accumulatedMs + (now - startedAt) 推导时长。

import { useEffect, useReducer, useCallback, useRef } from 'react'
import {
  TRACKS,
  createInitialState,
  startTimer,
  pauseTimer,
  resumeTimer,
  stopTimer,
  stopTimersForTodo,
  hasRunningTimerForTodo,
  getElapsedMs,
} from '../lib/timeStore'

// 停止事件注册点（与 timeStore 共用同一监听器集合），供后续日报模块复用。
export { subscribe } from '../lib/timeStore'

export const TIMING_STORAGE_KEY = 'prodash.time-tracking.v1'
export const REFRESH_INTERVAL_MS = 1000

function keyFor(todoId, track) {
  return `${todoId}:${track}`
}

// 读取快照；读不到 / JSON 损坏 / 结构非法时降级为空状态并标记 error，不向上抛异常。
function readSnapshot() {
  try {
    if (typeof window === 'undefined') {
      return { snapshot: createInitialState(), error: false }
    }
    const raw = window.localStorage.getItem(TIMING_STORAGE_KEY)
    if (raw === null) return { snapshot: createInitialState(), error: false }
    const parsed = JSON.parse(raw)
    const valid =
      parsed &&
      typeof parsed === 'object' &&
      parsed.active &&
      typeof parsed.active === 'object' &&
      !Array.isArray(parsed.active) &&
      Array.isArray(parsed.records)
    if (!valid) return { snapshot: createInitialState(), error: true }
    return {
      snapshot: { active: sanitizeActive(parsed.active), records: parsed.records },
      error: false,
    }
  } catch {
    return { snapshot: createInitialState(), error: true }
  }
}

// 清洗恢复的 active 条目：钳制/补齐数值字段。
// running 但 startedAt 非法时降级为暂停态，避免 getElapsedMs 出现 NaN 崩溃。
function sanitizeActive(active) {
  const out = {}
  for (const [key, entry] of Object.entries(active)) {
    if (!entry || typeof entry !== 'object') continue
    const running = entry.running === true && typeof entry.startedAt === 'number'
    const startedAt = running ? entry.startedAt : null
    out[key] = {
      id: typeof entry.id === 'string' ? entry.id : `restored-${key}`,
      todoId: typeof entry.todoId === 'string' ? entry.todoId : key.split(':')[0],
      track: TRACKS.includes(entry.track) ? entry.track : 'human',
      startedAt,
      accumulatedMs:
        typeof entry.accumulatedMs === 'number' && entry.accumulatedMs > 0
          ? entry.accumulatedMs
          : 0,
      running,
      sessionStartedAt:
        typeof entry.sessionStartedAt === 'number' ? entry.sessionStartedAt : startedAt,
      segments: Array.isArray(entry.segments) ? entry.segments : [],
    }
  }
  return out
}

// 写快照；失败返回 true（由调用方转成 saveError），不向上抛异常。
function writeSnapshot(active, records) {
  try {
    window.localStorage.setItem(TIMING_STORAGE_KEY, JSON.stringify({ active, records }))
    return false
  } catch {
    return true
  }
}

function init() {
  const { snapshot, error } = readSnapshot()
  return {
    active: snapshot.active,
    records: snapshot.records,
    now: Date.now(),
    dirty: false,
    loadError: error,
    saveError: false,
  }
}

// 合并领域状态变更；空操作（timeStore 返回同一引用）保持原引用，不触发持久化。
function withChange(prev, next, now) {
  if (next === prev) return prev
  return { ...next, now, dirty: true, loadError: prev.loadError, saveError: prev.saveError }
}

function reducer(state, action) {
  switch (action.type) {
    case 'tick':
      return { ...state, now: action.now }
    case 'start':
      return withChange(state, startTimer(state, action.todoId, action.track, action.now), action.now)
    case 'pause':
      return withChange(
        state,
        pauseTimer(state, keyFor(action.todoId, action.track), action.now),
        action.now,
      )
    case 'resume':
      return withChange(
        state,
        resumeTimer(state, keyFor(action.todoId, action.track), action.now),
        action.now,
      )
    case 'stop':
      return withChange(
        state,
        stopTimer(state, keyFor(action.todoId, action.track), action.now),
        action.now,
      )
    case 'stopForTodo':
      return withChange(state, stopTimersForTodo(state, action.todoId, action.now), action.now)
    case 'saveResult':
      return { ...state, saveError: action.error, dirty: false }
    default:
      return state
  }
}

export function useTaskTimers() {
  const [state, dispatch] = useReducer(reducer, undefined, init)
  const stateRef = useRef(state)
  stateRef.current = state

  // 只在领域变更（dirty）后持久化；tick 与恢复不写入。
  useEffect(() => {
    if (!state.dirty) return
    dispatch({ type: 'saveResult', error: writeSnapshot(state.active, state.records) })
  }, [state])

  // 仅触发 UI 刷新：所有时长在渲染时用 Date.now() 计算，不写 localStorage。
  useEffect(() => {
    const id = setInterval(() => {
      dispatch({ type: 'tick', now: Date.now() })
    }, REFRESH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  // 回到前台立即刷新；页面隐藏（含刷新/关闭前的 pagehide）时持久化快照。
  useEffect(() => {
    function persistNow() {
      dispatch({
        type: 'saveResult',
        error: writeSnapshot(stateRef.current.active, stateRef.current.records),
      })
    }
    function handleVisibility() {
      if (document.visibilityState === 'hidden') persistNow()
      else dispatch({ type: 'tick', now: Date.now() })
    }
    function handlePageHide() {
      persistNow()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('pagehide', handlePageHide)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('pagehide', handlePageHide)
      // 卸载时尽力持久化当前快照（组件已卸载，不再 dispatch）
      writeSnapshot(stateRef.current.active, stateRef.current.records)
    }
  }, [])

  const start = useCallback((todoId, track) => {
    dispatch({ type: 'start', todoId, track, now: Date.now() })
  }, [])
  const pause = useCallback((todoId, track) => {
    dispatch({ type: 'pause', todoId, track, now: Date.now() })
  }, [])
  const resume = useCallback((todoId, track) => {
    dispatch({ type: 'resume', todoId, track, now: Date.now() })
  }, [])
  const stop = useCallback((todoId, track) => {
    dispatch({ type: 'stop', todoId, track, now: Date.now() })
  }, [])
  const stopForTodo = useCallback((todoId) => {
    dispatch({ type: 'stopForTodo', todoId, now: Date.now() })
  }, [])

  // 供 UI 展示：每个轨道返回 { active, running, elapsedMs }，elapsedMs 用当前系统时间实时计算。
  function getTodoSummary(todoId) {
    const nowMs = Date.now()
    const summary = {}
    for (const track of TRACKS) {
      const entry = state.active[keyFor(todoId, track)]
      summary[track] = {
        active: Boolean(entry),
        running: entry?.running === true,
        elapsedMs: getElapsedMs(entry, nowMs),
      }
    }
    return summary
  }

  // 删除保护语义：仅运行中的计时返回 true，暂停中的计时不阻止删除。
  function hasRunning(todoId) {
    return hasRunningTimerForTodo(state, todoId)
  }

  return {
    loadError: state.loadError,
    saveError: state.saveError,
    start,
    pause,
    resume,
    stop,
    stopForTodo,
    getTodoSummary,
    hasRunning,
  }
}
