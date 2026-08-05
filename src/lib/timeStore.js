// 纯 JavaScript 双轨计时领域模块：human / agent 两轨，无 slot 上限。
// 不依赖 React、不依赖 Dify；状态不可变，所有时长以毫秒时间戳计算。
//
// 数据契约（持久化 key 见 hook 层）：
//   active: {
//     "todoId:track": {
//       id, todoId, track, startedAt, accumulatedMs, running,
//       sessionStartedAt, segments
//     }
//   }
//   records: [{ id, todoId, track, startedAt, endedAt, durationMs, segments }]
//
// 运行中条目：startedAt 为当前运行段起点，时长 = accumulatedMs + max(0, now - startedAt)，
// 系统时间前拨时被钳制为 0，不会出现负数。

export const TRACKS = ['human', 'agent']

export const DELETED_TODO_LABEL = '已删除任务'

const listeners = new Set()

/**
 * 注册停止事件监听。返回解除订阅函数。
 * 事件形状：{ type: 'stop', record }
 */
export function subscribe(listener) {
  listeners.add(listener)
  return function unsubscribe() {
    listeners.delete(listener)
  }
}

function notifyStop(record) {
  const event = { type: 'stop', record }
  for (const listener of listeners) {
    try {
      listener(event)
    } catch {
      // 单个 listener 出错不应影响计时状态流转
    }
  }
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `timer-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function keyFor(todoId, track) {
  return `${todoId}:${track}`
}

function clampNonNegative(value) {
  return Math.max(0, value)
}

export function createInitialState() {
  return { active: {}, records: [] }
}

/**
 * 启动指定待办的指定轨道计时。key 已存在（运行中或暂停中）时为空操作。
 */
export function startTimer(state, todoId, track, now) {
  const key = keyFor(todoId, track)
  if (state.active[key]) return state
  const entry = {
    id: createId(),
    todoId,
    track,
    startedAt: now,
    accumulatedMs: 0,
    running: true,
    sessionStartedAt: now,
    segments: [],
  }
  return { ...state, active: { ...state.active, [key]: entry } }
}

/**
 * 当前运行时长（毫秒）。运行中 = 已固化累计 + 当前段时长；暂停中 = 已固化累计。
 */
export function getElapsedMs(entry, now) {
  if (!entry) return 0
  if (!entry.running) return entry.accumulatedMs
  return entry.accumulatedMs + clampNonNegative(now - entry.startedAt)
}

/**
 * 暂停指定 key 的计时：固化当前段到 segments，累计时长，置为暂停状态。
 * 非运行中或缺失 key 为空操作。
 */
export function pauseTimer(state, key, now) {
  const entry = state.active[key]
  if (!entry || !entry.running) return state
  const segment = {
    startedAt: entry.startedAt,
    endedAt: now,
    durationMs: clampNonNegative(now - entry.startedAt),
  }
  const updated = {
    ...entry,
    running: false,
    startedAt: null,
    accumulatedMs: entry.accumulatedMs + segment.durationMs,
    segments: [...entry.segments, segment],
  }
  return { ...state, active: { ...state.active, [key]: updated } }
}

/**
 * 恢复暂停的计时：从 now 开启新段。运行中或缺失 key 为空操作。
 */
export function resumeTimer(state, key, now) {
  const entry = state.active[key]
  if (!entry || entry.running) return state
  const updated = { ...entry, running: true, startedAt: now }
  return { ...state, active: { ...state.active, [key]: updated } }
}

/**
 * 停止指定 key 的计时：从 active 移除，固化为完整 record 并追加到 records，
 * 同时向已注册 listener 发送停止事件。缺失 key 为空操作。
 */
export function stopTimer(state, key, now) {
  const entry = state.active[key]
  if (!entry) return state
  const { [key]: _removed, ...restActive } = state.active
  const closed = entry.running
    ? {
        startedAt: entry.startedAt,
        endedAt: now,
        durationMs: clampNonNegative(now - entry.startedAt),
      }
    : null
  const finalSegments = closed ? [...entry.segments, closed] : entry.segments
  const durationMs = closed
    ? entry.accumulatedMs + closed.durationMs
    : entry.accumulatedMs
  const record = {
    id: entry.id,
    todoId: entry.todoId,
    track: entry.track,
    startedAt: entry.sessionStartedAt,
    endedAt: now,
    durationMs,
    segments: finalSegments,
  }
  const next = { active: restActive, records: [...state.records, record] }
  notifyStop(record)
  return next
}

/**
 * 该待办是否存在运行中的计时（供删除保护使用；暂停中的计时不阻止删除）。
 */
export function hasRunningTimerForTodo(state, todoId) {
  return Object.values(state.active).some(
    (entry) => entry.todoId === todoId && entry.running,
  )
}

/**
 * 停止指定待办的全部计时（含运行中与暂停中），生成记录并通知。
 * 供“完成待办”使用。无相关计时时为空操作。
 */
export function stopTimersForTodo(state, todoId, now) {
  const keys = Object.keys(state.active).filter(
    (key) => state.active[key].todoId === todoId,
  )
  if (keys.length === 0) return state
  let next = state
  for (const key of keys) {
    next = stopTimer(next, key, now)
  }
  return next
}

function formatLocal(d) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toDateKey(input) {
  if (input instanceof Date) return formatLocal(input)
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [year, month, day] = input.split('-').map(Number)
    return formatLocal(new Date(year, month - 1, day))
  }
  return formatLocal(new Date(input))
}

/**
 * 生成指定日期的日报数据，不依赖 React/Dify。
 * 按记录 startedAt 的本地日期归属，不做跨日拆分。
 * 返回 { date, totalHumanMs, totalAgentMs, records }；
 * 找不到待办时任务名使用“已删除任务”。
 */
export function getReportData(state, todos, date) {
  const dateKey = toDateKey(date)
  const todoById = new Map((todos ?? []).map((todo) => [todo.id, todo]))
  const records = (state.records ?? [])
    .filter((record) => formatLocal(new Date(record.startedAt)) === dateKey)
    .map((record) => ({
      id: record.id,
      todoId: record.todoId,
      todoTitle: todoById.get(record.todoId)?.text ?? DELETED_TODO_LABEL,
      track: record.track,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      durationMs: record.durationMs,
      segments: record.segments,
    }))
  let totalHumanMs = 0
  let totalAgentMs = 0
  for (const record of records) {
    if (record.track === 'human') totalHumanMs += record.durationMs
    else if (record.track === 'agent') totalAgentMs += record.durationMs
  }
  return { date: dateKey, totalHumanMs, totalAgentMs, records }
}
