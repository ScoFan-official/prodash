// @vitest-environment node
// 调度器测试：直接测 runAutoReport（内存 repos + mock dify + mock publisher），不真起 cron。

import { describe, it, expect, vi, afterEach } from 'vitest';

import { createInMemoryRepos } from './repos/in-memory.js';
import { createDifyClient } from './dify/difyClient.js';
import { MockPublisher } from './publishers/index.js';
import { createReportService } from './services/reportService.js';
import { runAutoReport, startScheduler, stopScheduler, startTodoSync, stopTodoSync } from './scheduler.js';
import { localToday } from './repos/timeutil.js';

function makeService() {
  const repos = createInMemoryRepos();
  const service = createReportService({
    difyClient: createDifyClient({ mock: true }),
    publisher: new MockPublisher(),
  });
  return { repos, service };
}

afterEach(() => {
  stopScheduler();
});

describe('runAutoReport', () => {
  it('当天已 published → 跳过，不调用 generate', async () => {
    const { repos, service } = makeService();
    const today = localToday();
    await repos.reports.upsert({ date: today, content: '已有', status: 'published', version: 1 });

    const spy = vi.spyOn(service, 'generate');
    const result = await runAutoReport({ repos, service, date: today });

    expect(result.skipped).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('当天未发布 → 生成并发布', async () => {
    const { repos, service } = makeService();
    const today = localToday();

    const result = await runAutoReport({ repos, service, date: today });

    expect(result.skipped).toBe(false);
    expect(result.report).toBeTruthy();
    expect(result.report.reportDate).toBe(today);
    expect(result.report.status).toBe('published');
    expect(result.report.content).toContain('[Mock]');
  });

  it('extra 从 extras.getByDate 读取并注入 generate', async () => {
    const { repos, service } = makeService();
    const today = localToday();
    await repos.extras.upsert(today, {
      temporaryWork: '补充工作',
      meetings: '会议',
      risks: '',
      tomorrowPlan: '',
    });

    const spy = vi.spyOn(service, 'generate');
    await runAutoReport({ repos, service, date: today });

    expect(spy).toHaveBeenCalledWith(
      repos,
      expect.objectContaining({
        date: today,
        extraWork: expect.objectContaining({ temporaryWork: '补充工作' }),
        includeDeleted: false,
      })
    );
  });

  it('异常不崩溃，返回 error 信息', async () => {
    const repos = createInMemoryRepos();
    const service = {
      generate: async () => {
        throw new Error('dify down');
      },
    };
    const today = localToday();

    const result = await runAutoReport({ repos, service, date: today });
    expect(result.skipped).toBe(false);
    expect(result.error).toContain('dify down');
  });
});

describe('startScheduler', () => {
  it('非法 cron 抛错；合法 cron 返回任务并可停止', () => {
    expect(() => startScheduler({ repos: null, service: null, cron: 'not-a-cron' })).toThrow(/cron/);
    const task = startScheduler({ repos: {}, service: {}, cron: '0 0 1 1 *' });
    expect(task).toBeTruthy();
    stopScheduler();
  });
});

describe('startTodoSync', () => {
  // 独立清理：若断言失败导致 test 末尾 stopTodoSync 未执行，避免每秒 cron 悬挂 vitest 进程
  afterEach(() => {
    stopTodoSync();
  });

  it('非法 cron 抛错；合法每秒 cron 触发 run', async () => {
    expect(() => startTodoSync({ cron: 'not-a-cron', run: async () => {} })).toThrow(/cron/);
    const run = vi.fn().mockResolvedValue({ imported: 0 });
    startTodoSync({ cron: '* * * * * *', run }); // 每秒触发（node-cron 6 段）
    await new Promise((r) => setTimeout(r, 1100));
    expect(run).toHaveBeenCalled();
    stopTodoSync();
  });
});
