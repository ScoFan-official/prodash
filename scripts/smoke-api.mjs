// Prodash v1.0.0 全链路 API 冒烟测试（scripts/smoke-api.mjs）
//
// 运行前置：
//   1. 启动 MySQL：`docker compose up -d mysql`（首次自动执行 server/schema.sql 初始化）
//   2. 准备 .env：`cp .env.example .env`（默认 DIFY_MOCK=true、PUBLISHER=mock，无外部依赖）
//   3. 确保 8787 端口未被占用，从仓库根目录运行：`node scripts/smoke-api.mjs`
//
// 行为：单进程拉起 server（`node --env-file=.env server/index.js`，端口默认 8787），
// 依次断言：任务 CRUD、计时事件→records 90min 重构、completedAt、source humanMs、
// generate→published/version、extra 重生成 version+1、get/list、软删、404；
// 结束后 kill 子进程，按 PASS/FAIL 汇总并以其作为退出码。
//
// 断言约束（干净 DB 可复现）：
//   - version 断言基于"报告存在性"容错：干净 DB（首次初始化）下 generate=1、重生成=2；
//     重复运行/预置数据时按「已有 version + 1」校验（generate 前先 GET 当天 report）。
//   - records 的 90min 断言按 taskId 定位到本脚本创建的任务，不受预置数据影响。

import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const base = 'http://localhost:8787'
const child = spawn('node', ['--env-file=.env', 'server/index.js'], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
})
let out = ''
child.stdout.on('data', (d) => (out += d))
child.stderr.on('data', (d) => (out += d))

async function waitReady() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(base + '/api/tasks')
      if (r.ok) return true
    } catch {}
    await sleep(500)
  }
  return false
}

async function req(method, path, body) {
  const r = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { status: r.status, json }
}

const results = []
const log = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  |  ' + JSON.stringify(detail) : ''}`)
}

const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const t = (h, m) => {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

try {
  const ready = await waitReady()
  if (!ready) { console.log('SERVER NOT READY\n' + out); process.exit(1) }
  console.log('SERVER READY')

  const ok2xx = (r) => r.status >= 200 && r.status < 300
  let r = await req('POST', '/api/tasks', { title: '写周报', important: true, urgent: false })
  const taskA = r.json
  log('create task A', ok2xx(r) && !!taskA?.id)
  r = await req('POST', '/api/tasks', { title: '修 bug', important: false, urgent: true })
  const taskB = r.json
  log('create task B', ok2xx(r) && !!taskB?.id)

  const today = todayStr()
  r = await req('POST', '/api/time-events', { taskId: taskA.id, track: 'human', event: 'start', ts: t(9, 0) })
  log('time-event start', ok2xx(r))
  await req('POST', '/api/time-events', { taskId: taskA.id, track: 'human', event: 'pause', ts: t(9, 30) })
  await req('POST', '/api/time-events', { taskId: taskA.id, track: 'human', event: 'resume', ts: t(10, 0) })
  r = await req('POST', '/api/time-events', { taskId: taskA.id, track: 'human', event: 'stop', ts: t(11, 0) })
  log('time-event stop', ok2xx(r))

  r = await req('GET', `/api/time-events/records?date=${today}`)
  const records = r.json
  log('records today', Array.isArray(records) && records.length >= 1, records?.map((x) => x.durationMs))
  // 按 taskId 定位本脚本任务的记录（不依赖 records[0]，避免预置数据干扰）
  const recA = Array.isArray(records) ? records.find((x) => x.taskId === taskA.id) : null
  log('record duration 90min', recA?.durationMs === 90 * 60 * 1000, recA?.durationMs)
  log('record stopped not running', recA?.running === false, recA?.running)

  r = await req('GET', '/api/time-events/active')
  const ownActive = Array.isArray(r.json) ? r.json.filter((x) => x.taskId === taskA.id || x.taskId === taskB.id) : null
  log('no active sessions for smoke tasks', Array.isArray(r.json) && ownActive.length === 0, r.json)

  r = await req('PATCH', `/api/tasks/${taskA.id}`, { status: 'completed' })
  log('complete A sets completedAt', r.status === 200 && !!r.json.completedAt, r.json.completedAt)

  r = await req('GET', `/api/reports/source?date=${today}&includeDeleted=false`)
  const src = r.json
  log('report source', r.status === 200 && Array.isArray(src?.completedTodos) && src.completedTodos.length >= 1)
  log('source has humanMs', src?.completedTodos?.some((x) => x.humanMs > 0), src?.completedTodos?.map((x) => ({ title: x.title, humanMs: x.humanMs })))

  // 生成前先查该日期是否已有 report：干净 DB 无 → version 基线 0（首次 generate=1）
  r = await req('GET', `/api/reports?date=${today}`)
  const existingBeforeGenerate = r.json?.report || null
  const expectedGenVersion = (existingBeforeGenerate?.version ?? 0) + 1

  r = await req('POST', '/api/reports/generate', {
    date: today,
    extraWork: { temporaryWork: '参加评审会', meetings: '', risks: '', tomorrowPlan: '继续开发' },
    includeDeleted: false,
  })
  log('generate ok', r.status === 200 && typeof r.json?.content === 'string' && r.json.content.length > 0, r.json?.content?.slice(0, 50))
  log('generate -> published', r.json?.status === 'published', r.json?.status)
  log(`generate version +1 (clean DB=1, got ${expectedGenVersion})`, r.json?.version === expectedGenVersion, r.json?.version)
  log('generate docUrl', !!r.json?.docUrl, r.json?.docUrl)

  const generatedVersion = r.json?.version
  r = await req('PUT', `/api/reports/${today}/extra`, {
    temporaryWork: '参加评审会+补会', meetings: '', risks: '风险1', tomorrowPlan: '继续开发',
  })
  log('extra save -> regenerated', r.status === 200 && r.json?.regenerated === true, r.json?.regenerated)
  log(`regenerate version +1 (clean DB=2, got ${generatedVersion + 1})`, r.json?.report?.version === generatedVersion + 1, r.json?.report?.version)

  r = await req('GET', `/api/reports?date=${today}`)
  log('get report', r.status === 200 && !!r.json?.report && !!r.json?.extra, r.json?.report?.version)

  r = await req('GET', '/api/reports')
  log('list reports', Array.isArray(r.json) && r.json.length >= 1, r.json?.map((x) => x.date))

  r = await req('DELETE', `/api/tasks/${taskB.id}`)
  log('soft delete B', r.status === 200 && r.json?.status === 'deleted', r.json?.status)

  r = await req('POST', '/api/reports/2099-01-01/publish')
  log('publish missing report -> 4xx', r.status >= 400, r.status)

  const fails = results.filter((x) => !x.ok)
  console.log('---SUMMARY---')
  console.log(`PASS ${results.length - fails.length}/${results.length}`)
  process.exit(fails.length ? 1 : 0)
} catch (e) {
  console.log('SMOKE ERROR:', e.message)
  console.log(out)
  process.exit(1)
} finally {
  child.kill()
}
