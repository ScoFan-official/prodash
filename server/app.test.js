// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './app.js';
import { createInMemoryRepos } from './repos/in-memory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_PATH = path.resolve(__dirname, '../dist');

// 本地时区语义辅助：服务器日边界为 [本地 00:00, 次日 00:00)，测试时刻必须落在本地当天内
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// 本地墙钟 (y/m/d h:m:s) → UTC ISO（无论进程时区如何都落在对应本地日）
const localIso = (y, mo, d, h, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).toISOString();
// 本地「今天」的某个墙钟时刻 → UTC ISO
const todayIso = (h, mi = 0) => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, mi, 0).toISOString();
};

function makeApp() {
  const repos = createInMemoryRepos();
  // 钉钉回写 stub：真实 writebackStatus 在 todoSyncService.test.js 中覆盖
  const todoSyncService = {
    writebackStatus: vi.fn().mockResolvedValue(),
  };
  const app = createApp({ repos, todoSyncService });
  return { app, repos, todoSyncService };
}

let ctx;
beforeEach(() => {
  ctx = makeApp();
});

async function postTask(body) {
  return request(ctx.app).post('/api/tasks').send(body);
}

async function postEvent(body) {
  return request(ctx.app).post('/api/time-events').send(body);
}

describe('tasks API', () => {
  it('creates a task with defaults', async () => {
    const res = await postTask({ title: '写日报', important: true, urgent: false });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: 1,
      title: '写日报',
      important: true,
      urgent: false,
      status: 'active',
      completedAt: null,
      deletedAt: null,
    });
    expect(typeof res.body.createdAt).toBe('string');
  });

  it('rejects invalid task bodies', async () => {
    expect((await postTask({})).status).toBe(400);
    expect((await postTask({ title: '   ' })).status).toBe(400);
    expect((await postTask({ title: 'x'.repeat(501) })).status).toBe(400);
    expect((await postTask({ title: 42 })).status).toBe(400);
    expect((await postTask({ title: 'ok', important: 'yes' })).status).toBe(400);
    expect((await postTask({ title: 'ok', urgent: 1 })).status).toBe(400);
  });

  it('lists tasks', async () => {
    await postTask({ title: 'a' });
    await postTask({ title: 'b' });
    const res = await request(ctx.app).get('/api/tasks');
    expect(res.status).toBe(200);
    expect(res.body.map((t) => t.title)).toEqual(['b', 'a']);
  });

  it('patch: sets completedAt on completed, clears on active, keeps on repeat complete', async () => {
    const created = await postTask({ title: 't' });
    const id = created.body.id;

    const p1 = await request(ctx.app).patch(`/api/tasks/${id}`).send({ status: 'completed' });
    expect(p1.status).toBe(200);
    expect(p1.body.status).toBe('completed');
    expect(p1.body.completedAt).toBeTruthy();
    const firstCompletedAt = p1.body.completedAt;

    const p2 = await request(ctx.app).patch(`/api/tasks/${id}`).send({ status: 'completed' });
    expect(p2.body.completedAt).toBe(firstCompletedAt);

    const p3 = await request(ctx.app).patch(`/api/tasks/${id}`).send({ title: 't2', important: true });
    expect(p3.body.title).toBe('t2');
    expect(p3.body.important).toBe(true);
    expect(p3.body.completedAt).toBe(firstCompletedAt);

    const p4 = await request(ctx.app).patch(`/api/tasks/${id}`).send({ status: 'active' });
    expect(p4.body.status).toBe('active');
    expect(p4.body.completedAt).toBeNull();
  });

  it('patch: rejects invalid status and unknown id', async () => {
    const created = await postTask({ title: 't' });
    const id = created.body.id;
    expect((await request(ctx.app).patch(`/api/tasks/${id}`).send({ status: 'nope' })).status).toBe(400);
    expect((await request(ctx.app).patch('/api/tasks/9999').send({ title: 'x' })).status).toBe(404);
    expect((await request(ctx.app).patch('/api/tasks/abc').send({ title: 'x' })).status).toBe(400);
  });

  it('soft-deletes a task', async () => {
    const created = await postTask({ title: 'bye' });
    const id = created.body.id;
    const res = await request(ctx.app).delete(`/api/tasks/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('deleted');
    expect(res.body.deletedAt).toBeTruthy();

    const list = await request(ctx.app).get('/api/tasks');
    const t = list.body.find((x) => x.id === id);
    expect(t.status).toBe('deleted');

    expect((await request(ctx.app).delete('/api/tasks/9999')).status).toBe(404);
  });
});

describe('time-events API', () => {
  it('rejects invalid payloads', async () => {
    await postTask({ title: 't' });
    expect((await postEvent({ taskId: 'x', track: 'human', event: 'start', ts: 1 })).status).toBe(400);
    expect((await postEvent({ taskId: 1, track: 'robot', event: 'start', ts: 1 })).status).toBe(400);
    expect((await postEvent({ taskId: 1, track: 'human', event: 'fly', ts: 1 })).status).toBe(400);
    expect((await postEvent({ taskId: 1, track: 'human', event: 'start', ts: 'nope' })).status).toBe(400);
    expect((await postEvent({ taskId: 9999, track: 'human', event: 'start', ts: 1 })).status).toBe(404);
  });

  it('computes durations and reconstructs a session with pause/resume segments', async () => {
    await postTask({ title: 't' });
    const taskId = 1;

    // 用本地墙钟构造时刻：无论进程时区如何，都落在本地 2026-08-06 这一天
    const startTs = localIso(2026, 8, 6, 9, 0);
    const pauseTs = localIso(2026, 8, 6, 9, 5);
    const resumeTs = localIso(2026, 8, 6, 9, 6);
    const stopTs = localIso(2026, 8, 6, 9, 10);

    const start = await postEvent({ taskId, track: 'human', event: 'start', ts: startTs });
    expect(start.body.durationMs).toBe(0);

    const pause = await postEvent({ taskId, track: 'human', event: 'pause', ts: pauseTs });
    expect(pause.body.durationMs).toBe(300000);

    const resume = await postEvent({ taskId, track: 'human', event: 'resume', ts: resumeTs });
    expect(resume.body.durationMs).toBe(60000);

    const stop = await postEvent({ taskId, track: 'human', event: 'stop', ts: stopTs });
    expect(stop.body.durationMs).toBe(240000);

    const records = await request(ctx.app).get('/api/time-events/records?date=2026-08-06');
    expect(records.status).toBe(200);
    expect(records.body).toHaveLength(1);
    expect(records.body[0]).toMatchObject({
      todoId: taskId,
      track: 'human',
      startedAt: startTs,
      endedAt: stopTs,
      durationMs: 540000,
    });
    expect(records.body[0].segments).toEqual([
      { startedAt: startTs, endedAt: pauseTs, durationMs: 300000 },
      { startedAt: resumeTs, endedAt: stopTs, durationMs: 240000 },
    ]);

    const empty = await request(ctx.app).get('/api/time-events/records?date=2026-08-07');
    expect(empty.body).toEqual([]);
    expect((await request(ctx.app).get('/api/time-events/records?date=bad')).status).toBe(400);
  });

  it('reports active sessions (start/pause/resume/stop lifecycle)', async () => {
    await postTask({ title: 't' });
    const taskId = 1;

    const start = await postEvent({ taskId, track: 'human', event: 'start', ts: '2026-08-06T02:00:00.000Z' });
    expect(start.status).toBe(201);

    let active = await request(ctx.app).get('/api/time-events/active');
    expect(active.body).toHaveLength(1);
    expect(active.body[0]).toMatchObject({
      taskId,
      track: 'human',
      sessionStartedAt: '2026-08-06T02:00:00.000Z',
      accumulatedMs: 0,
      running: true,
      lastEventAt: '2026-08-06T02:00:00.000Z',
    });

    await postEvent({ taskId, track: 'human', event: 'pause', ts: '2026-08-06T02:10:00.000Z' });
    active = await request(ctx.app).get('/api/time-events/active');
    // I2：暂停中的会话也要返回（running:false），供前端刷新后恢复"继续"
    expect(active.body).toHaveLength(1);
    expect(active.body[0]).toMatchObject({
      taskId,
      track: 'human',
      sessionStartedAt: '2026-08-06T02:00:00.000Z',
      accumulatedMs: 600000,
      running: false,
      lastEventAt: '2026-08-06T02:10:00.000Z',
    });

    await postEvent({ taskId, track: 'human', event: 'resume', ts: '2026-08-06T02:11:00.000Z' });
    active = await request(ctx.app).get('/api/time-events/active');
    expect(active.body).toHaveLength(1);
    expect(active.body[0]).toMatchObject({
      accumulatedMs: 600000,
      running: true,
      lastEventAt: '2026-08-06T02:11:00.000Z',
    });

    await postEvent({ taskId, track: 'human', event: 'stop', ts: '2026-08-06T02:20:00.000Z' });
    active = await request(ctx.app).get('/api/time-events/active');
    expect(active.body).toHaveLength(0);
  });

  it('summarizes human/agent ms for a day', async () => {
    await postTask({ title: 't' });
    const taskId = 1;
    await postEvent({ taskId, track: 'human', event: 'start', ts: localIso(2026, 8, 6, 9, 0) });
    await postEvent({ taskId, track: 'human', event: 'stop', ts: localIso(2026, 8, 6, 9, 10) });
    await postEvent({ taskId, track: 'agent', event: 'start', ts: localIso(2026, 8, 6, 9, 20) });
    await postEvent({ taskId, track: 'agent', event: 'stop', ts: localIso(2026, 8, 6, 9, 30) });

    const res = await request(ctx.app).get('/api/time-events/summary?date=2026-08-06');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ totalHumanMs: 600000, totalAgentMs: 600000 });

    expect((await request(ctx.app).get('/api/time-events/summary?date=bad')).status).toBe(400);
  });
});

describe('reports source API', () => {
  const today = localToday();

  it('classifies completed/pending and aggregates durations', async () => {
    const done = await postTask({ title: '完成的任务' });
    const doneId = done.body.id;
    await request(ctx.app).patch(`/api/tasks/${doneId}`).send({ status: 'completed' });

    const pending = await postTask({ title: '待办任务' });
    const pendingId = pending.body.id;

    const deletedDone = await postTask({ title: '已完成但已删除' });
    const deletedId = deletedDone.body.id;
    await request(ctx.app).patch(`/api/tasks/${deletedId}`).send({ status: 'completed' });
    await request(ctx.app).delete(`/api/tasks/${deletedId}`);

    // 当日耗时：done 任务 human 5min；pending 任务 agent 2min（均为本地今天的墙钟时刻）
    await postEvent({ taskId: doneId, track: 'human', event: 'start', ts: todayIso(4, 0) });
    await postEvent({ taskId: doneId, track: 'human', event: 'stop', ts: todayIso(4, 5) });
    await postEvent({ taskId: pendingId, track: 'agent', event: 'start', ts: todayIso(5, 0) });
    await postEvent({ taskId: pendingId, track: 'agent', event: 'stop', ts: todayIso(5, 2) });

    const res = await request(ctx.app).get(`/api/reports/source?date=${today}&includeDeleted=false`);
    expect(res.status).toBe(200);

    const doneItem = res.body.completedTodos.find((t) => t.id === doneId);
    expect(doneItem).toMatchObject({ title: '完成的任务', humanMs: 300000, agentMs: 0 });
    expect(res.body.completedTodos.find((t) => t.id === deletedId)).toBeUndefined();

    const pendingItem = res.body.pendingTodos.find((t) => t.id === pendingId);
    expect(pendingItem).toMatchObject({ title: '待办任务', humanMs: 0, agentMs: 120000 });

    expect(res.body.totalHumanMs).toBe(300000);
    expect(res.body.totalAgentMs).toBe(120000);

    const withDeleted = await request(ctx.app).get(`/api/reports/source?date=${today}&includeDeleted=true`);
    const deletedItem = withDeleted.body.completedTodos.find((t) => t.id === deletedId);
    expect(deletedItem).toMatchObject({ title: '已完成但已删除' });
  });

  it('excludes tasks from other days and validates date', async () => {
    const done = await postTask({ title: '今天的任务' });
    await request(ctx.app).patch(`/api/tasks/${done.body.id}`).send({ status: 'completed' });

    const past = await request(ctx.app).get('/api/reports/source?date=2000-01-01');
    expect(past.status).toBe(200);
    expect(past.body.completedTodos).toEqual([]);
    expect(past.body.pendingTodos).toEqual([]);

    expect((await request(ctx.app).get('/api/reports/source?date=bad')).status).toBe(400);
    expect((await request(ctx.app).get('/api/reports/source')).status).toBe(400);
  });
});

describe('static hosting & error handling', () => {
  it('returns JSON 404 for unknown API routes', async () => {
    const res = await request(ctx.app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not Found' });
  });

  it('returns JSON 404 for non-GET unknown API paths', async () => {
    const res = await request(ctx.app).post('/api/unknown');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not Found' });
  });

  it('serves SPA fallback for non-API GET paths when dist exists', async () => {
    const res = await request(ctx.app).get('/some/client/route');
    if (fs.existsSync(DIST_PATH)) {
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/html/);
    } else {
      expect(res.status).toBe(404);
    }
  });

  it('serves index.html at root when dist exists', async () => {
    const res = await request(ctx.app).get('/');
    if (fs.existsSync(DIST_PATH)) {
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/html/);
    }
  });
});

describe('钉钉任务 PATCH 回写', () => {
  async function createDingtalkTask(repos, overrides = {}) {
    return repos.tasks.create({
      title: '领导任务', important: true, urgent: true,
      dingtalkTaskId: 'dt-1', source: 'dingtalk', sourceLeader: '闫佳琪',
      dueTime: null, syncOrigin: null, syncWriteback: 'none', status: 'active',
      ...overrides,
    });
  }

  it('完成 → 触发 writebackStatus（status=completed）且本地状态更新', async () => {
    const t = await createDingtalkTask(ctx.repos);
    const res = await request(ctx.app).patch(`/api/tasks/${t.id}`).send({ status: 'completed' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(ctx.todoSyncService.writebackStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' })
    );
  });

  it('取消完成 → 触发 writebackStatus（status=active）', async () => {
    const t = await createDingtalkTask(ctx.repos, { status: 'completed', completedAt: '2026-08-07T09:00:00.000Z' });
    const res = await request(ctx.app).patch(`/api/tasks/${t.id}`).send({ status: 'active' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    expect(ctx.todoSyncService.writebackStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active' })
    );
  });

  it('回写失败 → sync_writeback=pending，本地状态仍更新', async () => {
    const t = await createDingtalkTask(ctx.repos);
    ctx.todoSyncService.writebackStatus.mockRejectedValue(new Error('dws 不可用'));
    const res = await request(ctx.app).patch(`/api/tasks/${t.id}`).send({ status: 'completed' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.syncWriteback).toBe('pending');
  });

  it('本地任务 PATCH 不触发回写', async () => {
    const t = await ctx.repos.tasks.create({ title: '本地', important: false, urgent: false });
    await request(ctx.app).patch(`/api/tasks/${t.id}`).send({ status: 'completed' });
    expect(ctx.todoSyncService.writebackStatus).not.toHaveBeenCalled();
  });
});

describe('钉钉任务锁定', () => {
  it('DELETE 钉钉来源任务 → 403，且未被软删', async () => {
    const t = await ctx.repos.tasks.create({
      title: '领导任务', important: true, urgent: true,
      dingtalkTaskId: 'dt-1', source: 'dingtalk', sourceLeader: '闫佳琪',
      dueTime: null, syncOrigin: null, syncWriteback: 'none', status: 'active',
    });
    const res = await request(ctx.app).delete(`/api/tasks/${t.id}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('钉钉同步任务不可删除');
    expect((await ctx.repos.tasks.get(t.id)).status).toBe('active');
  });

  it('本地任务仍可删除', async () => {
    const t = await ctx.repos.tasks.create({ title: '本地', important: false, urgent: false });
    const res = await request(ctx.app).delete(`/api/tasks/${t.id}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('deleted');
  });

  it('PATCH 钉钉任务忽略 title/important/urgent（强制锁定）', async () => {
    const t = await ctx.repos.tasks.create({
      title: '领导任务', important: true, urgent: true,
      dingtalkTaskId: 'dt-1', source: 'dingtalk', status: 'active', syncWriteback: 'none',
    });
    const res = await request(ctx.app)
      .patch(`/api/tasks/${t.id}`)
      .send({ title: '篡改标题', important: false, urgent: false, status: 'completed' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('领导任务');
    expect(res.body.important).toBe(true);
    expect(res.body.urgent).toBe(true);
    expect(res.body.status).toBe('completed'); // 状态字段仍生效（回写由 Task 6 处理）
  });

  it('PATCH 钉钉任务只传锁定字段 → 200 返回现状（幂等）', async () => {
    const t = await ctx.repos.tasks.create({
      title: '领导任务', important: true, urgent: true,
      dingtalkTaskId: 'dt-1', source: 'dingtalk', status: 'active', syncWriteback: 'none',
    });
    const res = await request(ctx.app).patch(`/api/tasks/${t.id}`).send({ title: '篡改标题' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('领导任务');
  });

  it('GET /api/tasks 返回同步字段（camelCase）', async () => {
    await ctx.repos.tasks.create({
      title: '领导任务', important: true, urgent: true,
      dingtalkTaskId: 'dt-1', source: 'dingtalk', sourceLeader: '闫佳琪',
      dueTime: '2026-08-08T10:00:00.000Z', syncOrigin: 'certify_todo',
      syncWriteback: 'pending', status: 'active',
    });
    const res = await request(ctx.app).get('/api/tasks');
    expect(res.body[0]).toMatchObject({
      dingtalkTaskId: 'dt-1', source: 'dingtalk', sourceLeader: '闫佳琪',
      dueTime: '2026-08-08T10:00:00.000Z', syncOrigin: 'certify_todo', syncWriteback: 'pending',
    });
  });

  it('PATCH 钉钉任务 status=deleted → 403（禁止通过补丁绕过删除锁）', async () => {
    const t = await ctx.repos.tasks.create({
      title: '领导任务', important: true, urgent: true,
      dingtalkTaskId: 'dt-1', source: 'dingtalk', status: 'active', syncWriteback: 'none',
    });
    const res = await request(ctx.app).patch(`/api/tasks/${t.id}`).send({ status: 'deleted' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('钉钉同步任务不可删除');
    expect((await ctx.repos.tasks.get(t.id)).status).toBe('active');
  });
});
