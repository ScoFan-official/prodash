import { DELETED_TODO_LABEL } from './timeStore'
import { QUADRANTS, getQuadrantKey } from './quadrants'

const CATEGORY_COLORS = {
  'important-urgent': 'var(--q1)',
  'important-not-urgent': 'var(--q2)',
  'not-important-urgent': 'var(--q3)',
  'not-important-not-urgent': 'var(--q4)',
  deleted: 'var(--text-muted)',
}

function formatLocal(d) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toDateKey(input) {
  if (input instanceof Date) return formatLocal(input)
  return formatLocal(new Date(input))
}

function clampNonNegative(value) {
  return Math.max(0, value)
}

export function formatDuration(ms) {
  const minutes = Math.floor(clampNonNegative(ms) / 60000)
  if (minutes === 0) return '0 分钟'
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  if (hours === 0) return `${minutes} 分钟`
  if (restMinutes === 0) return `${hours} 小时`
  return `${hours} 小时 ${restMinutes} 分钟`
}

export function formatDurationShort(ms) {
  const minutes = Math.floor(clampNonNegative(ms) / 60000)
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  if (hours > 0) return `${hours}h${restMinutes}m`
  return `${restMinutes}m`
}

export function percent(part, total) {
  if (!total || total <= 0) return 0
  return Math.round((part / total) * 1000) / 10
}

export function formatPercent(part, total) {
  return `${percent(part, total)}%`
}

/**
 * 将活动计时条目合成为「尚未停止的记录」，供统计复用 records 的按 segment 日期聚合逻辑。
 *
 * 固化语义与 stopTimer 一致：segments = 已固化段 + 当前运行段（仅运行中）；
 * 运行中时长按 now 计算，系统时间前拨时钳制为 0；暂停中条目只贡献已固化段。
 */
function activeEntryToCurrentRecord(entry, now) {
  if (!entry || typeof entry !== 'object') return null
  const hasRunningSegment = entry.running === true && typeof entry.startedAt === 'number'
  const closed = hasRunningSegment
    ? {
        startedAt: entry.startedAt,
        endedAt: now,
        durationMs: clampNonNegative(now - entry.startedAt),
      }
    : null
  const baseSegments = Array.isArray(entry.segments) ? entry.segments : []
  const segments = closed ? [...baseSegments, closed] : baseSegments
  return {
    id: entry.id,
    todoId: entry.todoId,
    track: entry.track,
    startedAt: entry.sessionStartedAt,
    endedAt: now,
    durationMs:
      (typeof entry.accumulatedMs === 'number' ? entry.accumulatedMs : 0) +
      (closed ? closed.durationMs : 0),
    segments,
  }
}

/**
 * 汇总指定日期的工时数据。
 *
 * state 为 timeStore 状态对象 { active, records }。
 * 运行中/暂停中的 active 条目按「截至 now 停止」合成暂态记录后一并参与聚合，
 * 因此计时运行中统计也能反映截至当前时刻的人工/Agent 时长。
 * 按 segment 的 startedAt 本地日期归属，不跨日拆分；找不到待办时使用「已删除任务」。
 * 返回：
 *   date, totalHumanMs, totalAgentMs, totalMs,
 *   byTask（按任务聚合，按总时长降序）,
 *   byCategory（按四象限分类聚合，按总时长降序）
 */
export function aggregateToday(state, todos, now = Date.now()) {
  const { active = {}, records = [] } = state ?? {}
  const currentRecords = Object.values(active)
    .map((entry) => activeEntryToCurrentRecord(entry, now))
    .filter(Boolean)
  const allRecords = [...records, ...currentRecords]
  const dateKey = toDateKey(now)
  // todo.id 为数字（后端 BIGINT），record.todoId 统一为 String，映射键归一为 String。
  const todoById = new Map((todos ?? []).map((todo) => [String(todo.id), todo]))
  const taskMap = new Map()
  const categoryMap = new Map()
  let totalHumanMs = 0
  let totalAgentMs = 0

  for (const record of allRecords ?? []) {
    if (!record || typeof record !== 'object' || !Array.isArray(record.segments)) {
      continue
    }

    const todo = todoById.get(record.todoId)
    const title = todo?.text ?? DELETED_TODO_LABEL

    for (const segment of record.segments) {
      if (!segment || typeof segment !== 'object') continue

      const startDate = new Date(segment.startedAt)
      if (Number.isNaN(startDate.getTime())) continue
      if (formatLocal(startDate) !== dateKey) continue

      const durationMs = clampNonNegative(
        typeof segment.durationMs === 'number' ? segment.durationMs : 0,
      )

      if (record.track === 'human') totalHumanMs += durationMs
      else if (record.track === 'agent') totalAgentMs += durationMs

      if (!taskMap.has(record.todoId)) {
        taskMap.set(record.todoId, {
          todoId: record.todoId,
          title,
          humanMs: 0,
          agentMs: 0,
          totalMs: 0,
        })
      }
      const task = taskMap.get(record.todoId)
      if (record.track === 'human') task.humanMs += durationMs
      else if (record.track === 'agent') task.agentMs += durationMs
      task.totalMs += durationMs

      const categoryKey = todo ? getQuadrantKey(todo.important, todo.urgent) : 'deleted'
      if (!categoryMap.has(categoryKey)) {
        categoryMap.set(categoryKey, {
          key: categoryKey,
          label: todo ? QUADRANTS[categoryKey].title : DELETED_TODO_LABEL,
          color: CATEGORY_COLORS[categoryKey],
          totalMs: 0,
        })
      }
      categoryMap.get(categoryKey).totalMs += durationMs
    }
  }

  const byTask = Array.from(taskMap.values()).sort((a, b) => b.totalMs - a.totalMs)
  const byCategory = Array.from(categoryMap.values()).sort((a, b) => b.totalMs - a.totalMs)
  const totalMs = totalHumanMs + totalAgentMs

  return {
    date: dateKey,
    totalHumanMs,
    totalAgentMs,
    totalMs,
    byTask,
    byCategory,
  }
}
