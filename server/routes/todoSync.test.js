// @vitest-environment node
// 钉钉同步路由测试（supertest）：service 用 stub 注入。
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createTodoSyncRouter } from './todoSync.js';

function makeService(overrides = {}) {
  return {
    isConfigured: () => true,
    throttleSkip: async () => null,
    syncFromDingtalk: async () => ({
      syncedAt: '2026-08-07T12:00:00.000Z', imported: 3, updated: 5,
      softDeleted: 1, writeback: { retried: 2, pending: 0 },
    }),
    getStatus: () => ({ syncedAt: null, lastResult: null, profile: 'corp:user' }),
    ...overrides,
  };
}

function makeApp(service) {
  const app = express();
  app.use(express.json());
  app.use('/api/todo-sync', createTodoSyncRouter({ service }));
  return app;
}

describe('POST /api/todo-sync', () => {
  it('触发同步并返回结果', async () => {
    const sync = vi.fn().mockResolvedValue({
      syncedAt: '2026-08-07T12:00:00.000Z', imported: 3, updated: 5,
      softDeleted: 1, writeback: { retried: 2, pending: 0 },
    });
    const app = makeApp(makeService({ syncFromDingtalk: sync }));
    const res = await request(app).post('/api/todo-sync');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ imported: 3, updated: 5, softDeleted: 1, writeback: { retried: 2, pending: 0 } });
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('节流内第二次触发返回缓存结果，不执行同步', async () => {
    const cached = { syncedAt: '2026-08-07T12:00:00.000Z', imported: 0, updated: 0, softDeleted: 0, writeback: { retried: 0, pending: 0 } };
    const sync = vi.fn();
    const app = makeApp(makeService({ throttleSkip: async () => cached, syncFromDingtalk: sync }));
    const res = await request(app).post('/api/todo-sync');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(cached);
    expect(sync).not.toHaveBeenCalled();
  });

  it('同步进行中返回 202 { inFlight: true }', async () => {
    const app = makeApp(makeService({ syncFromDingtalk: async () => ({ inFlight: true }) }));
    const res = await request(app).post('/api/todo-sync');
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ inFlight: true });
  });

  it('未配置 profile → 503 fail-fast', async () => {
    const app = makeApp(makeService({ isConfigured: () => false }));
    const res = await request(app).post('/api/todo-sync');
    expect(res.status).toBe(503);
    expect(res.body.error).toContain('DINGTALK_TODO_PROFILE');
  });
});

describe('GET /api/todo-sync', () => {
  it('返回上次同步状态', async () => {
    const app = makeApp(makeService());
    const res = await request(app).get('/api/todo-sync');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ syncedAt: null, lastResult: null, profile: 'corp:user' });
  });
});
