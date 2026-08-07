// 统一 fetch 封装：所有日报接口请求都走这里，返回解析后的 JSON。
// 网络错误 / 非 2xx 均抛出 Error（优先使用后端 {error} 字段，否则通用文案「请求失败」）。
// 开发模式下 vite 会将 /api 代理到后端（见 vite.config.js server.proxy）。

const API_BASE = '/api'
const REQUEST_TIMEOUT_MS = 15000

async function request(path, options = {}) {
  let response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      // 默认 15s 超时：后端挂起时 fetch 不再无限 pending（超时走 AbortError → 抛「请求失败」）。
      // signal 放在 ...options 之前，调用方如需自定义 signal 可覆盖。
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...options,
    })
  } catch {
    throw new Error('请求失败')
  }

  let data = null
  try {
    data = await response.json()
  } catch {
    // 非 JSON 响应（如空 body）按状态码处理
  }

  if (!response.ok) {
    const message =
      data && typeof data.error === 'string' && data.error
        ? data.error
        : '请求失败'
    throw new Error(message)
  }
  return data
}

// GET /api/reports/source?date=YYYY-MM-DD&includeDeleted=true|false
export function getReportSource(date, includeDeleted) {
  const params = new URLSearchParams({ date })
  if (typeof includeDeleted === 'boolean') {
    params.set('includeDeleted', String(includeDeleted))
  }
  return request(`/reports/source?${params.toString()}`)
}

// POST /api/reports/generate body {date, extraWork?, includeDeleted?}
export function generateReport({ date, extraWork, includeDeleted }) {
  const body = { date }
  if (extraWork !== undefined) body.extraWork = extraWork
  if (typeof includeDeleted === 'boolean') body.includeDeleted = includeDeleted
  return request('/reports/generate', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// POST /api/reports/:date/publish（补发重试）
export function publishReport(date) {
  return request(`/reports/${encodeURIComponent(date)}/publish`, {
    method: 'POST',
  })
}

// PUT /api/reports/:date/extra body {temporaryWork, meetings, risks, tomorrowPlan}
export function saveExtra(date, extra) {
  return request(`/reports/${encodeURIComponent(date)}/extra`, {
    method: 'PUT',
    body: JSON.stringify(extra),
  })
}

// GET /api/reports?date=YYYY-MM-DD → {report|null, extra|null}
export function getReport(date) {
  return request(`/reports?date=${encodeURIComponent(date)}`)
}

// GET /api/reports → 历史列表
export function listReports() {
  return request('/reports')
}

// ── 任务（tasks）──
// GET /api/tasks → [{id,title,important,urgent,status,createdAt,completedAt,deletedAt}]
// status ∈ active | completed | deleted
export function getTasks() {
  return request('/tasks')
}

// POST /api/tasks {title,important,urgent} → 201 新任务（id 为数字）
export function createTask({ title, important, urgent }) {
  const body = { title }
  if (typeof important === 'boolean') body.important = important
  if (typeof urgent === 'boolean') body.urgent = urgent
  return request('/tasks', { method: 'POST', body: JSON.stringify(body) })
}

// PATCH /api/tasks/:id 部分字段；status:'completed'→completedAt 服务端写入；status:'active'→清 completedAt
export function updateTask(id, patch) {
  return request(`/tasks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

// DELETE /api/tasks/:id → 200 软删除（status='deleted', deletedAt 写入）
export function deleteTask(id) {
  return request(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

// ── 计时事件（time-events）──
// POST /api/time-events {taskId,track:'human'|'agent',event:'start'|'pause'|'resume'|'stop',ts(epoch ms)} → 201
export function postTimeEvent({ taskId, track, event, ts }) {
  return request('/time-events', {
    method: 'POST',
    body: JSON.stringify({ taskId, track, event, ts }),
  })
}

// GET /api/time-events/records?date=YYYY-MM-DD → 当日重构 records（todoId 为数字字符串）
export function getRecords(date) {
  return request(`/time-events/records?date=${encodeURIComponent(date)}`)
}

// GET /api/time-events/active → 未停止会话（时间字段可能是 epoch ms 数字或 ISO 字符串）
export function getActiveSessions() {
  return request('/time-events/active')
}

// ── 钉钉待办同步（todo-sync）──
// POST /api/todo-sync（手动触发同步；服务端 <2 分钟节流时返回缓存结果）
export function syncTodos() {
  return request('/todo-sync', { method: 'POST' })
}

// GET /api/todo-sync → { syncedAt, lastResult, profile, inFlight, configured }
export function getTodoSyncStatus() {
  return request('/todo-sync')
}
