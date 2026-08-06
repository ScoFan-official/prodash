// @vitest-environment node
// 日报路由测试（supertest）：全部使用 createInMemoryRepos + mock dify + mock publisher。

import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

import { createInMemoryRepos } from '../repos/in-memory.js';
import { createDifyClient } from '../dify/difyClient.js';
import { MockPublisher } from '../publishers/index.js';
import { createReportService } from '../services/reportService.js';
import { createReportsRouter } from './reports.js';
import { localToday } from '../repos/timeutil.js';

function makeApp() {
  const repos = createInMemoryRepos();
  const service = createReportService({
    difyClient: createDifyClient({ mock: true }),
    publisher: new MockPublisher(),
  });
  const app = express();
  app.use(express.json());
  app.use('/api/reports', createReportsRouter({ repos, service }));
  return { app, repos, service };
}

let ctx;
beforeEach(() => {
  ctx = makeApp();
});

describe('POST /api/reports/generate', () => {
  it('校验 date 格式与 extraWork 字段', async () => {
    const badDate = await request(ctx.app).post('/api/reports/generate').send({ date: 'bad' });
    expect(badDate.status).toBe(400);

    const tooLong = await request(ctx.app)
      .post('/api/reports/generate')
      .send({ date: '2026-08-06', extraWork: { temporaryWork: 'x'.repeat(5001) } });
    expect(tooLong.status).toBe(400);

    const wrongType = await request(ctx.app)
      .post('/api/reports/generate')
      .send({ date: '2026-08-06', extraWork: { meetings: 42 } });
    expect(wrongType.status).toBe(400);
  });

  it('成功生成并自动发布', async () => {
    const today = localToday();
    const res = await request(ctx.app).post('/api/reports/generate').send({ date: today });
    expect(res.status).toBe(200);
    expect(res.body.reportDate).toBe(today);
    expect(res.body.content).toContain('[Mock]');
    expect(res.body.status).toBe('published');
    expect(res.body.docNodeId).toBe(`mock-${today}`);
    expect(res.body.version).toBe(1);
  });
});

describe('POST /api/reports/:date/publish', () => {
  it('补发成功', async () => {
    const today = localToday();
    await request(ctx.app).post('/api/reports/generate').send({ date: today });
    const res = await request(ctx.app).post(`/api/reports/${today}/publish`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('published');
    expect(res.body.docUrl).toBe(`https://mock.local/daily/${today}`);
  });

  it('不存在的日期 → 404；非法日期 → 400', async () => {
    const missing = await request(ctx.app).post('/api/reports/2099-01-01/publish');
    expect(missing.status).toBe(404);
    const bad = await request(ctx.app).post('/api/reports/not-a-date/publish');
    expect(bad.status).toBe(400);
  });
});

describe('PUT /api/reports/:date/extra', () => {
  it('无 report → 只保存不重生成', async () => {
    const today = localToday();
    const res = await request(ctx.app)
      .put(`/api/reports/${today}/extra`)
      .send({ temporaryWork: '临时事务', meetings: '例会' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ report: null, regenerated: false });

    const extra = await ctx.repos.extras.getByDate(today);
    expect(extra.temporaryWork).toBe('临时事务');
  });

  it('有 report → 触发重生成', async () => {
    const today = localToday();
    await request(ctx.app).post('/api/reports/generate').send({ date: today });
    const res = await request(ctx.app)
      .put(`/api/reports/${today}/extra`)
      .send({ temporaryWork: '补充临时工作' });
    expect(res.status).toBe(200);
    expect(res.body.regenerated).toBe(true);
    expect(res.body.report).toBeTruthy();
    expect(res.body.report.version).toBe(2);
    expect(res.body.report.content).toContain('[Mock]');
  });

  it('非法 date 与超长字段 → 400', async () => {
    expect((await request(ctx.app).put('/api/reports/bad/extra').send({})).status).toBe(400);
    expect(
      (await request(ctx.app).put(`/api/reports/${localToday()}/extra`).send({ risks: 'y'.repeat(5001) })).status
    ).toBe(400);
  });
});

describe('GET /api/reports', () => {
  it('?date= 返回 report 与 extra', async () => {
    const today = localToday();
    await request(ctx.app).post('/api/reports/generate').send({ date: today });
    await request(ctx.app).put(`/api/reports/${today}/extra`).send({ temporaryWork: 'x' });

    const res = await request(ctx.app).get(`/api/reports?date=${today}`);
    expect(res.status).toBe(200);
    expect(res.body.report.reportDate).toBe(today);
    expect(res.body.extra.temporaryWork).toBe('x');

    const empty = await request(ctx.app).get('/api/reports?date=2099-01-01');
    expect(empty.body).toEqual({ report: null, extra: null });
  });

  it('无 date → 历史列表', async () => {
    const today = localToday();
    await request(ctx.app).post('/api/reports/generate').send({ date: today });

    const res = await request(ctx.app).get('/api/reports');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toMatchObject({
      date: today,
      status: 'published',
      docUrl: `https://mock.local/daily/${today}`,
      version: 1,
    });
    expect(typeof res.body[0].updatedAt).toBe('string');
  });

  it('非法 date 参数 → 400', async () => {
    const res = await request(ctx.app).get('/api/reports?date=nope');
    expect(res.status).toBe(400);
  });
});
