// MySQL 仓库实现（运行时）。使用 mysql2/promise pool。
// 时间约定见 ./timeutil.js：JS 侧 ISO 字符串，SQL 侧 UTC 墙钟 DATETIME(3)。
// 调用方创建 pool 时应设置 { dateStrings: true, timezone: 'Z' }（见 server/index.js）。

import { parseTs, isoToSql, toIso, dayStartUtc, dayEndUtc } from './timeutil.js';
import { buildSessions } from './session.js';

const TASK_COLUMNS =
  'id, title, important, urgent, status, created_at, completed_at, deleted_at, ' +
  'dingtalk_task_id, source, source_leader, due_time, sync_origin, sync_writeback';

function mapTask(row) {
  return {
    id: row.id,
    title: row.title,
    important: !!row.important,
    urgent: !!row.urgent,
    status: row.status,
    createdAt: toIso(row.created_at),
    completedAt: toIso(row.completed_at),
    deletedAt: toIso(row.deleted_at),
    dingtalkTaskId: row.dingtalk_task_id ?? null,
    source: row.source ?? 'local',
    sourceLeader: row.source_leader ?? null,
    dueTime: toIso(row.due_time),
    syncOrigin: row.sync_origin ?? null,
    syncWriteback: row.sync_writeback ?? 'none',
  };
}

function mapEvent(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    track: row.track,
    event: row.event,
    ts: toIso(row.ts),
    durationMs: row.duration_ms,
  };
}

function mapReport(row) {
  return {
    id: row.id,
    reportDate: row.report_date,
    content: row.content,
    status: row.status,
    docUrl: row.doc_url,
    docNodeId: row.doc_node_id,
    includeDeleted: !!row.include_deleted,
    version: row.version,
    publishedAt: toIso(row.published_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export function createMysqlRepos(pool) {
  const taskRepo = {
    async list() {
      const [rows] = await pool.execute(
        `SELECT ${TASK_COLUMNS} FROM tasks ORDER BY id DESC`
      );
      return rows.map(mapTask);
    },
    async get(id) {
      const [rows] = await pool.execute(
        `SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ?`,
        [id]
      );
      return rows.length ? mapTask(rows[0]) : null;
    },
    async create({ title, important, urgent, status = 'active', completedAt = null,
                   dingtalkTaskId = null, source = 'local', sourceLeader = null,
                   dueTime = null, syncOrigin = null, syncWriteback = 'none' }) {
      const now = new Date().toISOString();
      const completedAtIso = status === 'completed' ? toIso(completedAt ?? now) : null;
      const dueTimeIso = toIso(dueTime);
      const [r] = await pool.execute(
        `INSERT INTO tasks (title, important, urgent, status, created_at, completed_at, updated_at,
                            dingtalk_task_id, source, source_leader, due_time, sync_origin, sync_writeback)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [title, important ? 1 : 0, urgent ? 1 : 0, status, isoToSql(now),
         completedAtIso ? isoToSql(completedAtIso) : null, isoToSql(now),
         dingtalkTaskId, source, sourceLeader, dueTimeIso ? isoToSql(dueTimeIso) : null,
         syncOrigin, syncWriteback]
      );
      return {
        id: r.insertId,
        title,
        important: !!important,
        urgent: !!urgent,
        status,
        createdAt: now,
        completedAt: completedAtIso,
        deletedAt: null,
        dingtalkTaskId,
        source,
        sourceLeader,
        dueTime: dueTimeIso,
        syncOrigin,
        syncWriteback,
      };
    },
    async update(id, patch) {
      const existing = await this.get(id);
      if (!existing) return null;

      const sets = [];
      const params = [];
      if ('title' in patch) {
        sets.push('title = ?');
        params.push(patch.title);
      }
      if ('important' in patch) {
        sets.push('important = ?');
        params.push(patch.important ? 1 : 0);
      }
      if ('urgent' in patch) {
        sets.push('urgent = ?');
        params.push(patch.urgent ? 1 : 0);
      }
      if ('status' in patch) {
        sets.push('status = ?');
        params.push(patch.status);
        if (patch.status === 'completed' && !existing.completedAt && !('completedAt' in patch)) {
          const now = new Date().toISOString();
          sets.push('completed_at = ?');
          params.push(isoToSql(now));
        } else if (patch.status === 'active' && !('completedAt' in patch)) {
          sets.push('completed_at = NULL');
        }
      }
      if ('dingtalkTaskId' in patch) {
        sets.push('dingtalk_task_id = ?');
        params.push(patch.dingtalkTaskId ?? null);
      }
      if ('source' in patch) {
        sets.push('source = ?');
        params.push(patch.source);
      }
      if ('sourceLeader' in patch) {
        sets.push('source_leader = ?');
        params.push(patch.sourceLeader ?? null);
      }
      if ('dueTime' in patch) {
        sets.push('due_time = ?');
        params.push(patch.dueTime ? isoToSql(toIso(patch.dueTime)) : null);
      }
      if ('syncOrigin' in patch) {
        sets.push('sync_origin = ?');
        params.push(patch.syncOrigin ?? null);
      }
      if ('syncWriteback' in patch) {
        sets.push('sync_writeback = ?');
        params.push(patch.syncWriteback);
      }
      if ('completedAt' in patch) {
        sets.push('completed_at = ?');
        params.push(patch.completedAt ? isoToSql(toIso(patch.completedAt)) : null);
      }
      const updatedAt = new Date().toISOString();
      sets.push('updated_at = ?');
      params.push(isoToSql(updatedAt));
      params.push(id);

      await pool.execute(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, params);
      return this.get(id);
    },
    async getByDingtalkTaskId(taskId) {
      const [rows] = await pool.execute(
        `SELECT ${TASK_COLUMNS} FROM tasks WHERE dingtalk_task_id = ?`,
        [taskId]
      );
      return rows.length ? mapTask(rows[0]) : null;
    },
    async setSyncWriteback(id, status) {
      const now = new Date().toISOString();
      await pool.execute(
        `UPDATE tasks SET sync_writeback = ?, updated_at = ? WHERE id = ?`,
        [status, isoToSql(now), id]
      );
      return this.get(id);
    },
    async softDelete(id) {
      const existing = await this.get(id);
      if (!existing) return null;
      const now = new Date().toISOString();
      await pool.execute(
        `UPDATE tasks SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ?`,
        [isoToSql(now), isoToSql(now), id]
      );
      return this.get(id);
    },
  };

  const timeEventsRepo = {
    async append({ taskId, track, event, ts }) {
      const tsIso = parseTs(ts);
      let durationMs = 0;
      if (event !== 'start') {
        const [rows] = await pool.execute(
          `SELECT ts FROM time_events
           WHERE task_id = ? AND track = ?
           ORDER BY ts DESC, id DESC LIMIT 1`,
          [taskId, track]
        );
        if (rows.length) {
          const prevIso = toIso(rows[0].ts);
          durationMs = Math.max(0, new Date(tsIso).getTime() - new Date(prevIso).getTime());
        }
      }
      const [r] = await pool.execute(
        `INSERT INTO time_events (task_id, track, event, ts, duration_ms)
         VALUES (?, ?, ?, ?, ?)`,
        [taskId, track, event, isoToSql(tsIso), durationMs]
      );
      return { id: r.insertId, taskId, track, event, ts: tsIso, durationMs };
    },
    async recordsForDay(dateStr, opts = {}) {
      // 日边界为本地时区语义：把 [本地 00:00, 次日 00:00) 换算成 UTC 时刻用于 SQL 比较；
      // 并把日窗口传给 buildSessions，让跨日会话按天归因（I1），避免两天各计 0ms；
      // opts.asOf 为归因时刻（默认 Date.now()），运行中/尾巴会话按 min(windowEnd, asOf) 截断（I1-a）。
      const startIso = dayStartUtc(dateStr);
      const endIso = dayEndUtc(dateStr);
      const start = isoToSql(startIso);
      const end = isoToSql(endIso);
      const [rows] = await pool.execute(
        `SELECT id, task_id, track, event, ts, duration_ms FROM time_events
         WHERE ts >= ? AND ts < ?
         ORDER BY ts ASC, id ASC`,
        [start, end]
      );
      return buildSessions(rows.map(mapEvent), { windowStart: startIso, windowEnd: endIso, asOf: opts.asOf }).map((s) => ({ ...s, todoId: s.taskId }));
    },
    async activeSessions() {
      // I2：暂停中的会话（last-event=pause）也要返回（running:false），
      // 供前端刷新后恢复"继续"；running 会话行为不变。
      // I5：segments=已完成段（running 会话不含当前运行尾段；暂停会话为全部段），
      // 供前端用 active 单源呈现运行中时长，避免与 records 的合成尾段双计。
      const [rows] = await pool.execute(
        `SELECT id, task_id, track, event, ts, duration_ms FROM time_events
         ORDER BY ts ASC, id ASC`
      );
      return buildSessions(rows.map(mapEvent))
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
      const [rows] = await pool.execute(
        `SELECT id, report_date, content, status, doc_url, doc_node_id,
                include_deleted, version, published_at, created_at, updated_at
         FROM reports WHERE report_date = ?`,
        [dateStr]
      );
      return rows.length ? mapReport(rows[0]) : null;
    },
    async list() {
      const [rows] = await pool.execute(
        `SELECT id, report_date, content, status, doc_url, doc_node_id,
                include_deleted, version, published_at, created_at, updated_at
         FROM reports ORDER BY report_date DESC`
      );
      return rows.map(mapReport);
    },
    async upsert({ date, content = null, status = 'draft', docUrl, docNodeId, includeDeleted = false, version = null }) {
      const existing = await this.getByDate(date);
      const now = new Date().toISOString();
      const nextVersion =
        version !== null && version !== undefined ? version : existing ? existing.version + 1 : 0;
      // 首次进入 published 时打点 published_at
      const publishedAtSql =
        status === 'published'
          ? existing?.publishedAt
            ? isoToSql(existing.publishedAt)
            : isoToSql(now)
          : existing
            ? isoToSql(existing.publishedAt)
            : null;
      // C1：docUrl/docNodeId 仅「显式传 null」才清空；未传则保留既有值（重生成/publish_failed 不清旧链接）
      const docUrlSql = docUrl === undefined ? (existing?.docUrl ?? null) : docUrl;
      const docNodeIdSql = docNodeId === undefined ? (existing?.docNodeId ?? null) : docNodeId;
      const [r] = await pool.execute(
        `INSERT INTO reports (report_date, content, status, doc_url, doc_node_id,
                              include_deleted, version, published_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           content = VALUES(content),
           status = VALUES(status),
           doc_url = VALUES(doc_url),
           doc_node_id = VALUES(doc_node_id),
           include_deleted = VALUES(include_deleted),
           version = VALUES(version),
           published_at = IF(published_at IS NULL, VALUES(published_at), published_at),
           updated_at = VALUES(updated_at)`,
        [date, content, status, docUrlSql, docNodeIdSql, includeDeleted ? 1 : 0, nextVersion,
         publishedAtSql, isoToSql(now), isoToSql(now)]
      );
      return this.getByDate(date);
    },
  };

  const extrasRepo = {
    async getByDate(dateStr) {
      const [rows] = await pool.execute(
        `SELECT report_date, temporary_work, meetings, risks, tomorrow_plan, updated_at
         FROM report_extra WHERE report_date = ?`,
        [dateStr]
      );
      if (!rows.length) return null;
      const r = rows[0];
      return {
        temporaryWork: r.temporary_work,
        meetings: r.meetings,
        risks: r.risks,
        tomorrowPlan: r.tomorrow_plan,
        updatedAt: toIso(r.updated_at),
      };
    },
    async upsert(dateStr, extra) {
      const now = new Date().toISOString();
      await pool.execute(
        `INSERT INTO report_extra (report_date, temporary_work, meetings, risks, tomorrow_plan, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           temporary_work = VALUES(temporary_work),
           meetings = VALUES(meetings),
           risks = VALUES(risks),
           tomorrow_plan = VALUES(tomorrow_plan),
           updated_at = VALUES(updated_at)`,
        [dateStr, extra?.temporaryWork ?? null, extra?.meetings ?? null,
         extra?.risks ?? null, extra?.tomorrowPlan ?? null, isoToSql(now)]
      );
      return this.getByDate(dateStr);
    },
  };

  return { tasks: taskRepo, timeEvents: timeEventsRepo, reports: reportsRepo, extras: extrasRepo };
}
