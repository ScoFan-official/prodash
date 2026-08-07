// Prodash 后端 Express 应用工厂。
// createApp({ repos, reportRouter }) -> express 实例。路由只依赖 repos 接口，不依赖具体实现。
// reportRouter 可选：由入口组装日报写操作路由（server/routes/reports.js）。

import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseTs, isValidDateStr } from './repos/timeutil.js';
import { buildReportSource } from './services/reportService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TASK_STATUSES = ['active', 'completed', 'deleted'];
const TRACKS = ['human', 'agent'];
const EVENTS = ['start', 'pause', 'resume', 'stop'];

// 简单 async handler 包装：把 Promise rejection 交给统一错误处理
const ah = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function validateTaskBody(body) {
  const { title, important, urgent } = body || {};
  if (typeof title !== 'string' || !title.trim() || title.length > 500) {
    return { error: 'title must be a non-empty string of at most 500 characters' };
  }
  if (important !== undefined && important !== null && typeof important !== 'boolean') {
    return { error: 'important must be a boolean' };
  }
  if (urgent !== undefined && urgent !== null && typeof urgent !== 'boolean') {
    return { error: 'urgent must be a boolean' };
  }
  return { value: { title, important: !!important, urgent: !!urgent } };
}

function validateTaskPatch(body) {
  const patch = {};
  const keys = ['title', 'important', 'urgent', 'status'];
  for (const k of keys) {
    if (!(k in body)) continue;
    const v = body[k];
    if (k === 'title') {
      if (typeof v !== 'string' || !v.trim() || v.length > 500) {
        return { error: 'title must be a non-empty string of at most 500 characters' };
      }
      patch.title = v;
    } else if (k === 'important' || k === 'urgent') {
      if (typeof v !== 'boolean') return { error: `${k} must be a boolean` };
      patch[k] = v;
    } else if (k === 'status') {
      if (!TASK_STATUSES.includes(v)) return { error: 'status must be active|completed|deleted' };
      patch.status = v;
    }
  }
  if (Object.keys(patch).length === 0) return { error: 'no valid fields to update' };
  return { value: patch };
}

export function createApp({ repos, reportRouter, todoSyncRouter, todoSyncService }) {
  const app = express();
  app.use(express.json());

  // 无 CORS：后端托管 H5（同域），开发时由 vite 代理 /api，见 vite.config.js server.proxy
  // ---------------------------------------------------------------- tasks
  app.get(
    '/api/tasks',
    ah(async (req, res) => {
      res.json(await repos.tasks.list());
    })
  );

  app.post(
    '/api/tasks',
    ah(async (req, res) => {
      const check = validateTaskBody(req.body);
      if (check.error) return res.status(400).json({ error: check.error });
      const task = await repos.tasks.create(check.value);
      res.status(201).json(task);
    })
  );

  app.patch(
    '/api/tasks/:id',
    ah(async (req, res) => {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: 'invalid task id' });
      const body = req.body || {};
      const existing = await repos.tasks.get(id);
      if (!existing) return res.status(404).json({ error: 'Not Found' });
      if (existing.source === 'dingtalk') {
        // 标题锁定：忽略 title；四象限锁定：忽略 important/urgent（同步时服务端强制 1）
        delete body.title;
        delete body.important;
        delete body.urgent;
      }
      const check = validateTaskPatch(body);
      if (check.error) return res.status(400).json({ error: check.error });
      // 即时回写：完成/取消完成双向对称；失败置 pending（本地状态照常更新，乐观生效）
      if (todoSyncService && existing.source === 'dingtalk' && 'status' in check.value) {
        try {
          await todoSyncService.writebackStatus({ task: existing, status: check.value.status });
        } catch {
          await repos.tasks.setSyncWriteback(id, 'pending');
        }
      }
      const task = await repos.tasks.update(id, check.value);
      res.json(task);
    })
  );

  app.delete(
    '/api/tasks/:id',
    ah(async (req, res) => {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: 'invalid task id' });
      const task = await repos.tasks.softDelete(id);
      if (!task) return res.status(404).json({ error: 'Not Found' });
      res.json(task);
    })
  );

  // ----------------------------------------------------------- time-events
  app.post(
    '/api/time-events',
    ah(async (req, res) => {
      const { taskId, track, event, ts } = req.body || {};
      if (!Number.isInteger(taskId) || taskId <= 0) {
        return res.status(400).json({ error: 'taskId must be a positive integer' });
      }
      if (!TRACKS.includes(track)) return res.status(400).json({ error: 'track must be human|agent' });
      if (!EVENTS.includes(event)) return res.status(400).json({ error: 'event must be start|pause|resume|stop' });
      let tsIso;
      try {
        tsIso = parseTs(ts);
      } catch {
        return res.status(400).json({ error: 'ts must be a number (epoch ms) or ISO string' });
      }
      const task = await repos.tasks.get(taskId);
      if (!task) return res.status(404).json({ error: 'Not Found' });
      const row = await repos.timeEvents.append({ taskId, track, event, ts: tsIso });
      res.status(201).json(row);
    })
  );

  app.get(
    '/api/time-events/records',
    ah(async (req, res) => {
      const date = req.query.date;
      if (!isValidDateStr(date)) {
        return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      }
      res.json(await repos.timeEvents.recordsForDay(date));
    })
  );

  app.get(
    '/api/time-events/active',
    ah(async (req, res) => {
      res.json(await repos.timeEvents.activeSessions());
    })
  );

  app.get(
    '/api/time-events/summary',
    ah(async (req, res) => {
      const date = req.query.date;
      if (!isValidDateStr(date)) {
        return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      }
      const records = await repos.timeEvents.recordsForDay(date);
      let totalHumanMs = 0;
      let totalAgentMs = 0;
      for (const r of records) {
        if (r.track === 'human') totalHumanMs += r.durationMs;
        else if (r.track === 'agent') totalAgentMs += r.durationMs;
      }
      res.json({ totalHumanMs, totalAgentMs });
    })
  );

  // --------------------------------------------------------------- reports
  // 只读 source 端点；逻辑已重构进 server/services/reportService.js 的 buildReportSource。
  app.get(
    '/api/reports/source',
    ah(async (req, res) => {
      const date = req.query.date;
      if (!isValidDateStr(date)) {
        return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      }
      const includeDeleted = req.query.includeDeleted === 'true';
      res.json(await buildReportSource(repos, { date, includeDeleted }));
    })
  );

  // 日报写操作路由（generate/publish/extra/查询），由入口组装后注入
  if (reportRouter) {
    app.use('/api/reports', reportRouter);
  }

  // 钉钉待办同步路由，由入口组装后注入（未配置 DINGTALK_TODO_PROFILE 时由路由层返回 503）
  if (todoSyncRouter) {
    app.use('/api/todo-sync', todoSyncRouter);
  }

  // ---------------------------------------------------------- 静态托管 / SPA
  const distPath = path.resolve(__dirname, '../dist');
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    // 非 /api 的 GET 全部 fallback 到 index.html（SPA 路由）
    app.get(/^\/(?!api(\/|$)).*/, (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // ---------------------------------------------------------------- 404 / 错误
  app.use((req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'invalid JSON body' });
    }
    console.error('[prodash-server]', err);
    res.status(err?.status && err.status < 500 ? err.status : 500).json({
      error: 'Internal Server Error',
    });
  });

  return app;
}
