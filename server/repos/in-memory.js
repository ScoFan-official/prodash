// 内存仓库实现：用于测试与离线开发。
// 与 createMysqlRepos 保持相同接口与语义（见 server/repos/README 或各方法注释）。

import { parseTs, dayStartUtc, dayEndUtc } from './timeutil.js';
import { buildSessions } from './session.js';

function clone(x) {
  return x === null || x === undefined ? x : JSON.parse(JSON.stringify(x));
}

export function createInMemoryRepos() {
  let taskSeq = 1;
  let eventSeq = 1;
  let reportSeq = 1;
  const tasks = [];
  const timeEvents = [];
  const reports = new Map(); // key: report_date
  const extras = new Map(); // key: report_date

  const taskRepo = {
    async list() {
      return clone(tasks.slice().sort((a, b) => b.id - a.id));
    },
    async get(id) {
      const t = tasks.find((x) => x.id === id);
      return t ? clone(t) : null;
    },
    async create({ title, important, urgent }) {
      const now = new Date().toISOString();
      const t = {
        id: taskSeq++,
        title,
        important: !!important,
        urgent: !!urgent,
        status: 'active',
        createdAt: now,
        completedAt: null,
        deletedAt: null,
      };
      tasks.push(t);
      return clone(t);
    },
    async update(id, patch) {
      const t = tasks.find((x) => x.id === id);
      if (!t) return null;
      if ('title' in patch) t.title = patch.title;
      if ('important' in patch) t.important = !!patch.important;
      if ('urgent' in patch) t.urgent = !!patch.urgent;
      if ('status' in patch) {
        t.status = patch.status;
        if (patch.status === 'completed' && !t.completedAt) {
          t.completedAt = new Date().toISOString();
        } else if (patch.status === 'active') {
          t.completedAt = null;
        }
      }
      return clone(t);
    },
    async softDelete(id) {
      const t = tasks.find((x) => x.id === id);
      if (!t) return null;
      t.status = 'deleted';
      t.deletedAt = new Date().toISOString();
      return clone(t);
    },
  };

  const timeEventsRepo = {
    async append({ taskId, track, event, ts }) {
      const tsIso = parseTs(ts);
      let durationMs = 0;
      if (event !== 'start') {
        const prev = timeEvents
          .filter((e) => e.taskId === taskId && e.track === track)
          .sort((a, b) => (a.ts === b.ts ? a.id - b.id : a.ts < b.ts ? -1 : 1))
          .pop();
        if (prev) {
          durationMs = Math.max(0, new Date(tsIso).getTime() - new Date(prev.ts).getTime());
        }
      }
      const ev = { id: eventSeq++, taskId, track, event, ts: tsIso, durationMs };
      timeEvents.push(ev);
      return clone(ev);
    },
    async recordsForDay(dateStr, opts = {}) {
      // 日边界为本地时区语义：[本地 00:00, 次日 00:00) 换算成 UTC 时刻；
      // 把日窗口传给 buildSessions，让跨日会话按天归因（I1），避免两天各计 0ms；
      // opts.asOf 为归因时刻（默认 Date.now()），运行中/尾巴会话按 min(windowEnd, asOf) 截断（I1-a）。
      const start = dayStartUtc(dateStr);
      const end = dayEndUtc(dateStr);
      const dayEvents = timeEvents.filter((e) => e.ts >= start && e.ts < end);
      return buildSessions(dayEvents, { windowStart: start, windowEnd: end, asOf: opts.asOf }).map((s) => ({ ...s, todoId: s.taskId }));
    },
    async activeSessions() {
      // I2：暂停中的会话（last-event=pause）也要返回（running:false），
      // 供前端刷新后恢复"继续"；running 会话行为不变。
      // I5：segments=已完成段（running 会话不含当前运行尾段；暂停会话为全部段），
      // 供前端用 active 单源呈现运行中时长，避免与 records 的合成尾段双计。
      return buildSessions(timeEvents)
        .filter((s) => s.running || s.lastEvent === 'pause')
        .map((s) => ({
          taskId: s.taskId,
          track: s.track,
          sessionStartedAt: s.startedAt,
          accumulatedMs: s.durationMs,
          running: s.running,
          lastEventAt: s.lastEventAt,
          segments: s.segments,
        }));
    },
  };

  const reportsRepo = {
    async getByDate(dateStr) {
      const r = reports.get(dateStr);
      return r ? clone(r) : null;
    },
    async list() {
      return clone([...reports.values()].sort((a, b) => b.reportDate.localeCompare(a.reportDate)));
    },
    async upsert({ date, content, status = 'draft', docUrl, docNodeId, includeDeleted = false, version = null }) {
      const now = new Date().toISOString();
      const existing = reports.get(date);
      const nextVersion = version !== null && version !== undefined ? version : existing ? existing.version + 1 : 0;
      // 首次进入 published 时打点 published_at（与 schema 字段语义一致）
      const publishedAt = status === 'published' ? (existing?.publishedAt ?? now) : (existing ? existing.publishedAt : null);
      // C1：docUrl/docNodeId 仅「显式传 null」才清空；未传则保留既有值（重生成/publish_failed 不清旧链接）
      const rec = {
        id: existing ? existing.id : reportSeq++,
        reportDate: date,
        content: content ?? null,
        status,
        docUrl: docUrl === undefined ? (existing?.docUrl ?? null) : docUrl,
        docNodeId: docNodeId === undefined ? (existing?.docNodeId ?? null) : docNodeId,
        includeDeleted: !!includeDeleted,
        version: nextVersion,
        publishedAt,
        createdAt: existing ? existing.createdAt : now,
        updatedAt: now,
      };
      reports.set(date, rec);
      return clone(rec);
    },
  };

  const extrasRepo = {
    async getByDate(dateStr) {
      const x = extras.get(dateStr);
      if (!x) return null;
      return {
        temporaryWork: x.temporaryWork,
        meetings: x.meetings,
        risks: x.risks,
        tomorrowPlan: x.tomorrowPlan,
        updatedAt: x.updatedAt,
      };
    },
    async upsert(dateStr, extra) {
      const now = new Date().toISOString();
      const rec = {
        reportDate: dateStr,
        temporaryWork: extra?.temporaryWork ?? null,
        meetings: extra?.meetings ?? null,
        risks: extra?.risks ?? null,
        tomorrowPlan: extra?.tomorrowPlan ?? null,
        updatedAt: now,
      };
      extras.set(dateStr, rec);
      return clone(rec);
    },
  };

  return { tasks: taskRepo, timeEvents: timeEventsRepo, reports: reportsRepo, extras: extrasRepo };
}
