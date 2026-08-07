// @vitest-environment node
// 日报服务测试：全部使用 createInMemoryRepos + mock dify + mock publisher。
// 测试时刻一律取「本地今天」内的偏移时刻，保证日边界语义下与进程时区无关。

import { describe, it, expect } from 'vitest';

import { createInMemoryRepos } from '../repos/in-memory.js';
import { createDifyClient } from '../dify/difyClient.js';
import { MockPublisher } from '../publishers/index.js';
import { createReportService, buildReportSource, formatDuration } from './reportService.js';
import { localToday, dayStartUtc } from '../repos/timeutil.js';

// 本地今天 00:00 起偏移 offsetMinutes 分钟的 UTC ISO 时刻（保证落在本地当天内）
const todayOffsetIso = (offsetMinutes) => {
  const start = dayStartUtc(localToday());
  return new Date(new Date(start).getTime() + offsetMinutes * 60000).toISOString();
};

function makeService({ difyClient = createDifyClient({ mock: true }), publisher = new MockPublisher() } = {}) {
  const repos = createInMemoryRepos();
  const service = createReportService({ difyClient, publisher });
  return { repos, service };
}

// 返回文本随 extra_work 变化的 dify stub，用于验证机制 (b) 的 content 更新
function inputAwareDify() {
  return {
    async runWorkflow(inputs = {}) {
      let extra = {};
      try {
        extra = JSON.parse(inputs.extra_work || '{}');
      } catch {
        // ignore
      }
      return {
        report: `input-aware 日报 temporaryWork=${extra.temporaryWork || ''} meetings=${extra.meetings || ''}`,
        generatedAt: new Date().toISOString(),
      };
    },
  };
}

describe('formatDuration（用时预格式化）', () => {
  it('整小时 / 时+分 / 仅分钟', () => {
    expect(formatDuration(3 * 3600 * 1000)).toBe('3 小时');
    expect(formatDuration(2 * 3600 * 1000 + 30 * 60000)).toBe('2 小时 30 分钟');
    expect(formatDuration(40 * 60000)).toBe('40 分钟');
  });
  it('不足 1 分钟 / 0 / 负数 / undefined', () => {
    expect(formatDuration(10000)).toBe('不足 1 分钟'); // 10 秒 → 四舍五入到 0 分钟
    expect(formatDuration(0)).toBe('不足 1 分钟');
    expect(formatDuration(-1)).toBe('不足 1 分钟');
    expect(formatDuration(undefined)).toBe('不足 1 分钟');
  });
  it('毫秒取整到分钟（四舍五入）', () => {
    expect(formatDuration(90 * 1000)).toBe('2 分钟'); // 1.5 分钟 → 2
    expect(formatDuration(59 * 60000 + 59 * 1000)).toBe('1 小时'); // ≈60 分钟
  });
});

describe('buildReportSource 口径', () => {
  it('完成/待办/已删/当日时长聚合', async () => {
    const { repos } = makeService();
    const today = localToday();

    const done = await repos.tasks.create({ title: '完成的任务' });
    await repos.tasks.update(done.id, { status: 'completed' });

    const pending = await repos.tasks.create({ title: '待办任务' });

    const deletedDone = await repos.tasks.create({ title: '已完成但已删除' });
    await repos.tasks.update(deletedDone.id, { status: 'completed' });
    await repos.tasks.softDelete(deletedDone.id);

    await repos.timeEvents.append({ taskId: done.id, track: 'human', event: 'start', ts: todayOffsetIso(1) });
    await repos.timeEvents.append({ taskId: done.id, track: 'human', event: 'stop', ts: todayOffsetIso(6) });
    await repos.timeEvents.append({ taskId: pending.id, track: 'agent', event: 'start', ts: todayOffsetIso(10) });
    await repos.timeEvents.append({ taskId: pending.id, track: 'agent', event: 'stop', ts: todayOffsetIso(13) });

    const source = await buildReportSource(repos, { date: today, includeDeleted: false });

    const doneItem = source.completedTodos.find((t) => t.id === done.id);
    expect(doneItem).toMatchObject({
      title: '完成的任务',
      important: false,
      urgent: false,
      humanMs: 300000,
      agentMs: 0,
    });
    expect(source.completedTodos.find((t) => t.id === deletedDone.id)).toBeUndefined();

    const pendingItem = source.pendingTodos.find((t) => t.id === pending.id);
    expect(pendingItem).toMatchObject({ title: '待办任务', humanMs: 0, agentMs: 180000 });

    expect(source.totalHumanMs).toBe(300000);
    expect(source.totalAgentMs).toBe(180000);

    // includeDeleted=true 时已删完成任务以原标题进入 completed
    const withDeleted = await buildReportSource(repos, { date: today, includeDeleted: true });
    expect(withDeleted.completedTodos.find((t) => t.id === deletedDone.id)).toMatchObject({
      title: '已完成但已删除',
    });
  });

  it('其他日期不计入', async () => {
    const { repos } = makeService();
    const today = localToday();
    await repos.tasks.create({ title: '随便' });

    const past = await buildReportSource(repos, { date: '2000-01-01', includeDeleted: false });
    expect(past.completedTodos).toEqual([]);
    expect(past.pendingTodos).toEqual([]);

    const nowSource = await buildReportSource(repos, { date: today });
    expect(nowSource.pendingTodos).toHaveLength(1);
  });
});

describe('generate', () => {
  it('成功：content 带 [Mock]、version=1、自动发布为 published', async () => {
    const { repos, service } = makeService();
    const today = localToday();
    const task = await repos.tasks.create({ title: '做点事' });
    await repos.tasks.update(task.id, { status: 'completed' });

    const report = await service.generate(repos, { date: today });
    expect(report.content).toContain('[Mock]');
    expect(report.status).toBe('published');
    expect(report.docUrl).toBe(`https://mock.local/daily/${today}`);
    expect(report.docNodeId).toBe(`mock-${today}`);
    expect(report.version).toBe(1);
    expect(report.publishedAt).toBeTruthy();
  });

  it('再次生成 version 递增', async () => {
    const { repos, service } = makeService();
    const today = localToday();
    await service.generate(repos, { date: today });
    const second = await service.generate(repos, { date: today });
    expect(second.version).toBe(2);
  });

  it('Dify inputs 含 time_summary 与每项 humanMs/agentMs', async () => {
    let captured;
    const { repos, service } = makeService({
      difyClient: {
        async runWorkflow(inputs) {
          captured = inputs;
          return { report: 'ok', generatedAt: new Date().toISOString() };
        },
      },
    });
    const today = localToday();
    const task = await repos.tasks.create({ title: 't' });
    await repos.tasks.update(task.id, { status: 'completed' });
    await repos.timeEvents.append({ taskId: task.id, track: 'human', event: 'start', ts: todayOffsetIso(1) });
    await repos.timeEvents.append({ taskId: task.id, track: 'human', event: 'stop', ts: todayOffsetIso(4) });

    await service.generate(repos, {
      date: today,
      extraWork: { temporaryWork: '补', meetings: '会', risks: '风险', tomorrowPlan: '计划' },
    });

    expect(captured.report_date).toBe(today);
    const completed = JSON.parse(captured.completed_tasks);
    expect(completed[0]).toMatchObject({
      id: task.id,
      title: 't',
      humanMs: 180000,
      agentMs: 0,
      humanTime: '3 分钟',
      agentTime: '不足 1 分钟',
      totalTime: '3 分钟',
    });
    expect(JSON.parse(captured.extra_work)).toEqual({ temporaryWork: '补', meetings: '会' });
    expect(captured.risks).toBe('风险');
    expect(captured.tomorrow_plan).toBe('计划');
    expect(JSON.parse(captured.time_summary)).toEqual({
      totalHumanMs: 180000,
      totalAgentMs: 0,
      totalHumanTime: '3 分钟',
      totalAgentTime: '不足 1 分钟',
    });
  });

  it('publish 失败 → status=publish_failed，不向上抛', async () => {
    const failingPublisher = { publish: async () => { throw new Error('dws down'); } };
    const { repos, service } = makeService({ publisher: failingPublisher });
    const today = localToday();

    const report = await service.generate(repos, { date: today });
    expect(report.status).toBe('publish_failed');
    expect(report.content).toContain('[Mock]');
    expect(report.docUrl).toBeNull();
  });

  it('publishReport 补发成功', async () => {
    const { repos, service } = makeService();
    const today = localToday();
    await service.generate(repos, { date: today });

    const published = await service.publishReport(repos, today);
    expect(published.status).toBe('published');
    expect(published.docUrl).toBe(`https://mock.local/daily/${today}`);
  });

  it('补发时 publisher 返回 url=null（dws doc update 不返回 URL）→ 保留已有 docUrl', async () => {
    const urlLessPublisher = {
      async publish(opts) {
        // 模拟 dws doc update：只返回 nodeId，响应里没有 URL
        return { nodeId: opts.existingNodeId || 'dws-1', url: null };
      },
    };
    const { repos, service } = makeService({ publisher: urlLessPublisher });
    const today = localToday();

    const first = await service.generate(repos, { date: today });
    expect(first.status).toBe('published');
    expect(first.docNodeId).toBe('dws-1');
    expect(first.docUrl).toBeNull(); // 首建 publisher 也没给 URL

    // 模拟首建后拿到真实链接（写入 report 行）
    await repos.reports.upsert({
      date: today,
      content: first.content,
      status: 'published',
      docUrl: 'https://alidocs.dingtalk.com/i/nodes/dws-1',
      docNodeId: 'dws-1',
      includeDeleted: first.includeDeleted,
      version: first.version,
    });

    const republished = await service.publishReport(repos, today);
    expect(republished.status).toBe('published');
    expect(republished.docUrl).toBe('https://alidocs.dingtalk.com/i/nodes/dws-1');
    expect(republished.docNodeId).toBe('dws-1');
  });
});

describe('C1：重生成保留 docNodeId/docUrl', () => {
  it('连续两次 generate：第二次 publisher 收到 existingNodeId === 第一次 nodeId（走 update 覆盖）', async () => {
    const calls = [];
    // 记录型 publisher：模拟 dws 语义——update（有 existingNodeId）返回同一 nodeId，create 才新建
    const recordingPublisher = {
      async publish(opts) {
        calls.push({ ...opts });
        const nodeId = opts.existingNodeId || `dws-${calls.length}`;
        return { nodeId, url: `https://wiki.example/doc/${nodeId}` };
      },
    };
    const { repos, service } = makeService({ publisher: recordingPublisher });
    const today = localToday();

    const first = await service.generate(repos, { date: today });
    expect(calls).toHaveLength(1);
    expect(calls[0].existingNodeId).toBeNull();
    expect(first.status).toBe('published');
    expect(first.docNodeId).toBe('dws-1');
    expect(first.docUrl).toBe('https://wiki.example/doc/dws-1');

    const second = await service.generate(repos, { date: today });
    expect(calls).toHaveLength(2);
    // 第二次必须复用第一次的 nodeId → DwsCliPublisher 走 update 而非 create
    expect(calls[1].existingNodeId).toBe('dws-1');
    expect(second.docNodeId).toBe('dws-1');
    expect(second.docUrl).toBe('https://wiki.example/doc/dws-1');
  });

  it('重生成失败（publish_failed）不清空旧 docUrl/docNodeId', async () => {
    let fail = false;
    const flakyPublisher = {
      async publish() {
        if (fail) throw new Error('dws down');
        return { nodeId: 'n1', url: 'https://wiki.example/doc/1' };
      },
    };
    const { repos, service } = makeService({ publisher: flakyPublisher });
    const today = localToday();

    const first = await service.generate(repos, { date: today });
    expect(first.status).toBe('published');
    expect(first.docNodeId).toBe('n1');

    fail = true;
    const second = await service.generate(repos, { date: today });
    expect(second.status).toBe('publish_failed');
    expect(second.docNodeId).toBe('n1');
    expect(second.docUrl).toBe('https://wiki.example/doc/1');
  });
});

describe('saveExtra（机制 b）', () => {
  it('无 report → 只保存，regenerated:false', async () => {
    const { repos, service } = makeService();
    const today = localToday();

    const result = await service.saveExtra(repos, today, {
      temporaryWork: '临时事务',
      meetings: '例会',
      risks: '风险A',
      tomorrowPlan: '明日计划',
    });
    expect(result).toEqual({ report: null, regenerated: false });

    const extra = await repos.extras.getByDate(today);
    expect(extra.temporaryWork).toBe('临时事务');
    expect(extra.meetings).toBe('例会');
  });

  it('有 report（version>0）→ 重生成，content 覆盖为新 extra', async () => {
    const { repos, service } = makeService({ difyClient: inputAwareDify() });
    const today = localToday();

    const first = await service.generate(repos, {
      date: today,
      extraWork: { temporaryWork: '旧', meetings: '', risks: '', tomorrowPlan: '' },
    });
    expect(first.content).toContain('temporaryWork=旧');

    const result = await service.saveExtra(repos, today, {
      temporaryWork: '新补充',
      meetings: '新会议',
      risks: '风险B',
      tomorrowPlan: '明日新计划',
    });

    expect(result.regenerated).toBe(true);
    expect(result.report).toBeTruthy();
    expect(result.report.version).toBe(first.version + 1);
    expect(result.report.content).toContain('temporaryWork=新补充');
    expect(result.report.content).toContain('meetings=新会议');
    expect(result.report.status).toBe('published');
  });
});

it('buildReportSource 附带 source/sourceLeader', async () => {
  const repos = createInMemoryRepos();
  await repos.tasks.create({
    title: '领导任务', important: true, urgent: true,
    dingtalkTaskId: 'dt-1', source: 'dingtalk', sourceLeader: '闫佳琪',
    status: 'completed', completedAt: '2026-08-07T09:00:00.000Z', syncWriteback: 'none',
  });
  const source = await buildReportSource(repos, { date: '2026-08-07' });
  expect(source.completedTodos[0]).toMatchObject({ source: 'dingtalk', sourceLeader: '闫佳琪' });
});
