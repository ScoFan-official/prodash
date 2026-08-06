// React 计时 hook：将纯领域模块 timeStore 绑定到 React 状态与后端 API。
//
// 职责边界：
//   - 领域逻辑（开始/暂停/继续/停止/记录/停止事件）全部委托给 ../lib/timeStore 的纯函数；
//   - 本文件负责 API 恢复（getActiveSessions + getRecords）、动作同步（best-effort POST time-event）、
//     tick 刷新与页面可见性刷出。
//
// 数据流：
//   - 启动恢复：mount 时并行 GET /api/time-events/active 与 GET /api/time-events/records?date=今天(本地)，
//     用返回构建初始 state；任一失败降级为空状态并标记 loadError（沿用现有 loadError 语义）。
//   - 动作同步：start / pause / resume / stop / stopForTodo 在 dispatch 领域状态变更的同时，
//     fire-and-forget POST 对应 time-event（失败置 saveError=true，不阻塞 UI）。
//   - 停止刷出：pagehide / visibilitychange(hidden) 时对当前所有 running 条目 POST stop 事件
//     （避免服务端 activeSessions 积累「永远运行」会话），同时本地照常 dispatch 停止。
//
// id 契约：后端任务 id 为 BIGINT 数字；timeStore 内 active 条目的 todoId 统一 String(taskId)，
// 对外 API 接收 number / string 并统一 String() 归一，比较时不会出现类型不匹配。

import { useEffect, useReducer, useCallback, useRef } from 'react'
import {
  TRACKS,
  startTimer,
  pauseTimer,
  resumeTimer,
  stopTimer,
  stopTimersForTodo,
  hasRunningTimerForTodo,
  getElapsedMs,
} from '../lib/timeStore'
import { getActiveSessions, getRecords, postTimeEvent } from '../api/client'

// 停止事件注册点（与 timeStore 共用同一监听器集合），供后续日报模块复用。
export { subscribe } from '../lib/timeStore'

export const REFRESH_INTERVAL_MS = 1000

function keyFor(todoId, track) {
  return `${todoId}:${track}`
}

// 统一转数字：服务端时间字段可能是 epoch ms 数字或 ISO 字符串。
function toNum(value) {
  if (value == null) return null
  if (typeof value === 'number') return Number.isNaN(value) ? null : value
  const str = String(value).trim()
  if (str === '') return null
  const n = Number(str)
  if (!Number.isNaN(n)) return n
  const t = Date.parse(str)
  return Number.isNaN(t) ? null : t
}

// POST body 的 taskId：BIGINT 数字优先，无法转数字时保留原值。
function toTaskId(value) {
  const n = Number(value)
  return Number.isNaN(n) ? value : n
}

function localDateString(d = new Date()) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// 服务端 active 会话 → timeStore active 条目。
// active 条目 = {id:`restored-${taskId}-${track}`, todoId:String(taskId), track,
//                startedAt, accumulatedMs, running, sessionStartedAt, segments}
// running:true   → startedAt = lastEventAt（运行中当前段起点），时长 = accumulatedMs + (now - startedAt)
// running:false  → 暂停会话（last-event=pause）：startedAt = null、accumulatedMs 为已固化累计，
//                  resume 时 resumeTimer 会用当前时间重新开启 startedAt，符合 timeStore 暂停条目语义。
// segments：来自服务端 active 会话新增的 segments 字段（已完成段数组），时间字段统一转数字。
//           running 会话 = 已完成段（不含当前运行尾段）；暂停会话 = 全部已完成段。
//           聚合统计时 active 条目以其 segments + 当前段（若运行中）单源呈现，避免与 records 双计（I5）。
function activeSessionsToState(sessions) {
  const active = {}
  for (const session of sessions ?? []) {
    if (!session || session.taskId == null) continue
    const taskId = String(session.taskId)
    const track = TRACKS.includes(session.track) ? session.track : 'human'
    const lastEventAt = toNum(session.lastEventAt)
    const running = session.running === true && lastEventAt !== null
    active[keyFor(taskId, track)] = {
      id: `restored-${taskId}-${track}`,
      todoId: taskId,
      track,
      startedAt: running ? lastEventAt : null,
      accumulatedMs: toNum(session.accumulatedMs) ?? 0,
      running,
      sessionStartedAt: toNum(session.sessionStartedAt) ?? lastEventAt ?? Date.now(),
      segments: (session.segments ?? []).map((segment) => ({
        startedAt: toNum(segment?.startedAt),
        endedAt: toNum(segment?.endedAt),
        durationMs: toNum(segment?.durationMs) ?? 0,
      })),
    }
  }
  return active
}

// 服务端当日 records → timeStore records（todoId 统一 String，时间字段统一数字）。
// I5：运行中会话的 record 带 running:true（含 I1-b 合成尾段），与 active 条目重复，
// 必须丢弃——运行中时长只由 active 条目单源呈现，避免聚合双计。
function recordsFromApi(records) {
  return (records ?? [])
    .filter((record) => record?.running !== true)
    .map((record) => ({
      id: record.id,
      todoId: String(record.todoId),
      track: TRACKS.includes(record.track) ? record.track : 'human',
      startedAt: toNum(record.startedAt),
      endedAt: toNum(record.endedAt),
      durationMs: toNum(record.durationMs) ?? 0,
      segments: (record.segments ?? []).map((segment) => ({
        startedAt: toNum(segment?.startedAt),
        endedAt: toNum(segment?.endedAt),
        durationMs: toNum(segment?.durationMs) ?? 0,
      })),
    }))
}

function init() {
  return {
    active: {},
    records: [],
    now: Date.now(),
    loadError: false,
    saveError: false,
  }
}

// 合并领域状态变更；空操作（timeStore 返回同一引用）保持原引用。
function withChange(prev, next, now) {
  if (next === prev) return prev
  return { ...next, now, loadError: prev.loadError, saveError: prev.saveError }
}

function reducer(state, action) {
  switch (action.type) {
    case 'tick':
      return { ...state, now: action.now }
    case 'restore': {
      // 按 key 合并而非整体覆盖：restore 只补缺失 key，
      // 若用户在恢复完成前已 start 了新计时，保留其条目（用户条目优先于同 key 恢复值）。
      const mergedActive = { ...action.active, ...state.active }
      // I5 防双计：打开中的会话（运行中或暂停）只由 active 条目单源呈现，
      // 排除与 active 同 key 的 records（服务端当日 records 会包含这些打开会话的重构记录）。
      const activeKeys = new Set(Object.keys(mergedActive))
      return {
        ...state,
        active: mergedActive,
        records: action.records.filter((r) => !activeKeys.has(keyFor(r.todoId, r.track))),
        loadError: action.loadError,
        now: action.now,
      }
    }
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
    case 'saveError':
      return { ...state, saveError: action.error }
    default:
      return state
  }
}

export function useTaskTimers() {
  const [state, dispatch] = useReducer(reducer, undefined, init)
  const stateRef = useRef(state)
  stateRef.current = state
  // 已刷出 stop 的 key 集合：防止 pagehide + visibilitychange 在同一事件循环内重复刷出。
  const flushedKeysRef = useRef(new Set())

  // best-effort POST time-event；仅在 saveError 实际变化时更新状态，避免无谓重渲染。
  const postEvent = useCallback(({ taskId, track, event }) => {
    postTimeEvent({ taskId: toTaskId(taskId), track, event, ts: Date.now() })
      .then(() => {
        if (stateRef.current.saveError) dispatch({ type: 'saveError', error: false })
      })
      .catch(() => {
        if (!stateRef.current.saveError) dispatch({ type: 'saveError', error: true })
      })
  }, [])

  // 启动恢复：并行拉取活跃会话与当日 records。
  useEffect(() => {
    let cancelled = false
    Promise.all([getActiveSessions(), getRecords(localDateString())])
      .then(([sessions, records]) => {
        if (cancelled) return
        flushedKeysRef.current.clear()
        dispatch({
          type: 'restore',
          active: activeSessionsToState(sessions),
          records: recordsFromApi(records),
          loadError: false,
          now: Date.now(),
        })
      })
      .catch(() => {
        if (cancelled) return
        flushedKeysRef.current.clear()
        dispatch({ type: 'restore', active: {}, records: [], loadError: true, now: Date.now() })
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 仅触发 UI 刷新：所有时长在渲染时用 Date.now() 计算，不写任何持久层。
  useEffect(() => {
    const id = setInterval(() => {
      dispatch({ type: 'tick', now: Date.now() })
    }, REFRESH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  // 停止刷出：页面隐藏（含刷新/关闭前的 pagehide）时对运行中条目 POST stop 并本地停止；
  // 回到前台立即刷新。
  useEffect(() => {
    function flushStops() {
      const { active } = stateRef.current
      const now = Date.now()
      for (const entry of Object.values(active)) {
        if (!entry || !entry.running) continue
        const key = keyFor(entry.todoId, entry.track)
        if (flushedKeysRef.current.has(key)) continue
        flushedKeysRef.current.add(key)
        postEvent({ taskId: entry.todoId, track: entry.track, event: 'stop' })
        dispatch({ type: 'stop', todoId: entry.todoId, track: entry.track, now })
      }
    }
    function handleVisibility() {
      if (document.visibilityState === 'hidden') flushStops()
      else dispatch({ type: 'tick', now: Date.now() })
    }
    function handlePageHide() {
      flushStops()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('pagehide', handlePageHide)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('pagehide', handlePageHide)
      // 组件卸载时（如切换标签）尽力 POST stop，避免服务端会话悬挂（组件已卸载，不再 dispatch）。
      const { active } = stateRef.current
      for (const entry of Object.values(active)) {
        if (entry?.running) {
          postEvent({ taskId: entry.todoId, track: entry.track, event: 'stop' })
        }
      }
    }
  }, [postEvent])

  const start = useCallback(
    (todoId, track) => {
      const id = String(todoId)
      dispatch({ type: 'start', todoId: id, track, now: Date.now() })
      flushedKeysRef.current.clear() // 新一轮会话重新武装刷出
      postEvent({ taskId: id, track, event: 'start' })
    },
    [postEvent],
  )
  const pause = useCallback(
    (todoId, track) => {
      const id = String(todoId)
      dispatch({ type: 'pause', todoId: id, track, now: Date.now() })
      postEvent({ taskId: id, track, event: 'pause' })
    },
    [postEvent],
  )
  const resume = useCallback(
    (todoId, track) => {
      const id = String(todoId)
      dispatch({ type: 'resume', todoId: id, track, now: Date.now() })
      flushedKeysRef.current.clear()
      postEvent({ taskId: id, track, event: 'resume' })
    },
    [postEvent],
  )
  const stop = useCallback(
    (todoId, track) => {
      const id = String(todoId)
      dispatch({ type: 'stop', todoId: id, track, now: Date.now() })
      postEvent({ taskId: id, track, event: 'stop' })
    },
    [postEvent],
  )
  const stopForTodo = useCallback(
    (todoId) => {
      const id = String(todoId)
      dispatch({ type: 'stopForTodo', todoId: id, now: Date.now() })
      // 该待办每个活跃轨道各 POST 一个 stop（含运行中与暂停中）。
      for (const entry of Object.values(stateRef.current.active)) {
        if (entry?.todoId === id) {
          postEvent({ taskId: id, track: entry.track, event: 'stop' })
        }
      }
    },
    [postEvent],
  )

  // 供 UI 展示：每个轨道返回 { active, running, elapsedMs }，elapsedMs 用当前系统时间实时计算。
  function getTodoSummary(todoId) {
    const nowMs = Date.now()
    const summary = {}
    for (const track of TRACKS) {
      const entry = state.active[keyFor(String(todoId), track)]
      summary[track] = {
        active: Boolean(entry),
        running: entry?.running === true,
        elapsedMs: getElapsedMs(entry, nowMs),
      }
    }
    return summary
  }

  // 删除保护语义：仅运行中的计时返回 true，暂停中的计时不阻止删除。
  // 用 useCallback 包装，依赖 state.active（仅领域变更时换引用，tick 不换），
  // 供调用方（如 TodoView 的删除拦截清除 effect）作为稳定依赖使用。
  const hasRunning = useCallback(
    (todoId) => hasRunningTimerForTodo(state, String(todoId)),
    [state.active],
  )

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
    active: state.active,
    records: state.records,
  }
}
