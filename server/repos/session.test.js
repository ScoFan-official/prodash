// @vitest-environment node
// I1：跨日会话必须按日窗口切分归因，避免"两天各计 0ms"导致时长丢失。
// I1-a：asOf 截断——运行中/尾巴会话只计到归因时刻（默认 Date.now()）。
// I1-b：窗口切分产生的合成段必须真实写入 segments，保证 sum(segments)===durationMs。
// I2：activeSessions 需把 last-event=pause 的暂停会话也返回（running:false）。
// I5：records 恒带 running 标记（供前端排除运行中会话）；activeSessions 输出
//     segments=已完成段（running 不含当前运行尾段），保证运行中时长 active 单源呈现。
// 用内存 repos 的 recordsForDay/activeSessions 直接断言（本地墙钟时刻构造 → 与进程时区无关）。

import { describe, it, expect } from 'vitest';

import { createInMemoryRepos } from './in-memory.js';
import { dayStartUtc, dayEndUtc } from './timeutil.js';

// 本地墙钟 (y/m/d h:m:s) → UTC ISO（该时刻落在对应本地日）
const localIso = (y, mo, d, h, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).toISOString();

const segSum = (session) => session.segments.reduce((sum, s) => sum + s.durationMs, 0);

describe('跨日会话日窗口切分（I1）', () => {
  it('start 22:00 → stop 次日 01:00：当天计 2h（22:00→24:00）、次日计 1h（00:00→01:00）', async () => {
    const repos = createInMemoryRepos();
    const taskId = 1;
    await repos.timeEvents.append({ taskId, track: 'human', event: 'start', ts: localIso(2026, 8, 6, 22, 0) });
    await repos.timeEvents.append({ taskId, track: 'human', event: 'stop', ts: localIso(2026, 8, 7, 1, 0) });

    // asOf 取会话结束后：模拟"当天结束后查询"，与真实运行时刻解耦
    const asOf = localIso(2026, 8, 7, 2, 0);
    const day1 = await repos.timeEvents.recordsForDay('2026-08-06', { asOf });
    const day2 = await repos.timeEvents.recordsForDay('2026-08-07', { asOf });

    // 当天：窗口内只有 start（延续过午夜），按 [startedAt, min(windowEnd, asOf)] 计
    expect(day1).toHaveLength(1);
    expect(day1[0]).toMatchObject({
      taskId,
      startedAt: localIso(2026, 8, 6, 22, 0),
      endedAt: dayEndUtc('2026-08-06'),
      durationMs: 2 * 3600 * 1000,
      running: true,
    });
    // I1-b：合成段 [22:00, 窗口尾) 必须真实入 segments，sum(segments)===durationMs
    expect(segSum(day1[0])).toBe(day1[0].durationMs);

    // 次日：窗口内只有 stop（尾巴），按 [dayStart, lastEvent] 计
    expect(day2).toHaveLength(1);
    expect(day2[0]).toMatchObject({
      taskId,
      startedAt: dayStartUtc('2026-08-07'),
      endedAt: localIso(2026, 8, 7, 1, 0),
      durationMs: 3600 * 1000,
      running: false,
    });
    expect(segSum(day2[0])).toBe(day2[0].durationMs);
  });

  it('正常同日 start→stop 完整会话仍为 90min，行为不变', async () => {
    const repos = createInMemoryRepos();
    const taskId = 2;
    await repos.timeEvents.append({ taskId, track: 'agent', event: 'start', ts: localIso(2026, 8, 6, 10, 0) });
    await repos.timeEvents.append({ taskId, track: 'agent', event: 'stop', ts: localIso(2026, 8, 6, 11, 30) });

    const day = await repos.timeEvents.recordsForDay('2026-08-06');
    expect(day).toHaveLength(1);
    expect(day[0]).toMatchObject({
      taskId,
      startedAt: localIso(2026, 8, 6, 10, 0),
      endedAt: localIso(2026, 8, 6, 11, 30),
      durationMs: 90 * 60 * 1000,
      running: false,
    });
    expect(segSum(day[0])).toBe(day[0].durationMs);
  });

  it('跨日会话带 pause/resume 尾巴：扣除窗口内暂停段，segments 求和===50min', async () => {
    const repos = createInMemoryRepos();
    const taskId = 3;
    // 会话自昨天 23:00 运行至今；窗口内 pause 00:30、resume 00:40、stop 01:00
    await repos.timeEvents.append({ taskId, track: 'human', event: 'start', ts: localIso(2026, 8, 6, 23, 0) });
    await repos.timeEvents.append({ taskId, track: 'human', event: 'pause', ts: localIso(2026, 8, 7, 0, 30) });
    await repos.timeEvents.append({ taskId, track: 'human', event: 'resume', ts: localIso(2026, 8, 7, 0, 40) });
    await repos.timeEvents.append({ taskId, track: 'human', event: 'stop', ts: localIso(2026, 8, 7, 1, 0) });

    // asOf 取最后事件之后，与真实运行时刻解耦
    const day2 = await repos.timeEvents.recordsForDay('2026-08-07', { asOf: localIso(2026, 8, 7, 2, 0) });
    expect(day2).toHaveLength(1);
    expect(day2[0]).toMatchObject({
      taskId,
      startedAt: dayStartUtc('2026-08-07'),
      endedAt: localIso(2026, 8, 7, 1, 0),
      // 00:00→00:30 运行 + 00:40→01:00 运行 = 50min（暂停段 00:30→00:40 不计）
      durationMs: 50 * 60 * 1000,
      running: false,
    });
    // I1-b：合成段 [00:00→00:30) 已入 segments，sum(segments)===durationMs===50min
    expect(segSum(day2[0])).toBe(50 * 60 * 1000);
    expect(day2[0].segments).toEqual([
      { startedAt: dayStartUtc('2026-08-07'), endedAt: localIso(2026, 8, 7, 0, 30), durationMs: 30 * 60 * 1000 },
      { startedAt: localIso(2026, 8, 7, 0, 40), endedAt: localIso(2026, 8, 7, 1, 0), durationMs: 20 * 60 * 1000 },
    ]);
  });

  it('运行中会话 asOf 截断：start 20:00、生成时刻 21:00 → 60min（不是 240min），sum(segments)===durationMs', async () => {
    const repos = createInMemoryRepos();
    const taskId = 4;
    await repos.timeEvents.append({ taskId, track: 'human', event: 'start', ts: localIso(2026, 8, 6, 20, 0) });

    // 21:00 生成日报：运行中会话只计到生成时刻，而非窗口尾（24:00）
    const day = await repos.timeEvents.recordsForDay('2026-08-06', { asOf: localIso(2026, 8, 6, 21, 0) });
    expect(day).toHaveLength(1);
    expect(day[0]).toMatchObject({
      taskId,
      startedAt: localIso(2026, 8, 6, 20, 0),
      endedAt: localIso(2026, 8, 6, 21, 0),
      durationMs: 60 * 60 * 1000,
      running: true,
    });
    expect(segSum(day[0])).toBe(day[0].durationMs);
    expect(day[0].segments).toEqual([
      { startedAt: localIso(2026, 8, 6, 20, 0), endedAt: localIso(2026, 8, 6, 21, 0), durationMs: 60 * 60 * 1000 },
    ]);
  });

  it('尾巴会话运行中 asOf 截断：午夜后 resume 仍在运行 → 只计到生成时刻', async () => {
    const repos = createInMemoryRepos();
    const taskId = 5;
    // 昨天 23:00 start、23:30 pause；今天 00:10 resume 后仍在运行
    await repos.timeEvents.append({ taskId, track: 'agent', event: 'start', ts: localIso(2026, 8, 6, 23, 0) });
    await repos.timeEvents.append({ taskId, track: 'agent', event: 'pause', ts: localIso(2026, 8, 6, 23, 30) });
    await repos.timeEvents.append({ taskId, track: 'agent', event: 'resume', ts: localIso(2026, 8, 7, 0, 10) });

    // 生成时刻 00:40：运行段 [00:10→00:40) = 30min，而非到窗口尾
    const day2 = await repos.timeEvents.recordsForDay('2026-08-07', { asOf: localIso(2026, 8, 7, 0, 40) });
    expect(day2).toHaveLength(1);
    expect(day2[0]).toMatchObject({
      taskId,
      startedAt: dayStartUtc('2026-08-07'),
      endedAt: localIso(2026, 8, 7, 0, 40),
      durationMs: 30 * 60 * 1000,
      running: true,
    });
    expect(segSum(day2[0])).toBe(day2[0].durationMs);
    expect(day2[0].segments).toEqual([
      { startedAt: localIso(2026, 8, 7, 0, 10), endedAt: localIso(2026, 8, 7, 0, 40), durationMs: 30 * 60 * 1000 },
    ]);
  });
});

describe('activeSessions 暂停会话契约（I2）', () => {
  it('start→pause 后返回 1 条 running:false，accumulatedMs=暂停前段长', async () => {
    const repos = createInMemoryRepos();
    const taskId = 6;
    await repos.timeEvents.append({ taskId, track: 'human', event: 'start', ts: localIso(2026, 8, 6, 9, 0) });
    await repos.timeEvents.append({ taskId, track: 'human', event: 'pause', ts: localIso(2026, 8, 6, 9, 10) });

    const active = await repos.timeEvents.activeSessions();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      taskId,
      track: 'human',
      sessionStartedAt: localIso(2026, 8, 6, 9, 0),
      accumulatedMs: 10 * 60 * 1000,
      running: false,
      lastEventAt: localIso(2026, 8, 6, 9, 10),
    });
  });

  it('start→pause→resume→stop 后 activeSessions 为空', async () => {
    const repos = createInMemoryRepos();
    const taskId = 7;
    await repos.timeEvents.append({ taskId, track: 'human', event: 'start', ts: localIso(2026, 8, 6, 9, 0) });
    await repos.timeEvents.append({ taskId, track: 'human', event: 'pause', ts: localIso(2026, 8, 6, 9, 10) });
    await repos.timeEvents.append({ taskId, track: 'human', event: 'resume', ts: localIso(2026, 8, 6, 9, 11) });
    await repos.timeEvents.append({ taskId, track: 'human', event: 'stop', ts: localIso(2026, 8, 6, 9, 20) });

    const active = await repos.timeEvents.activeSessions();
    expect(active).toEqual([]);
  });

  it('running 会话行为不变：start→resume 后仍返回 running:true 且 accumulatedMs 为已结束段和', async () => {
    const repos = createInMemoryRepos();
    const taskId = 8;
    await repos.timeEvents.append({ taskId, track: 'human', event: 'start', ts: localIso(2026, 8, 6, 9, 0) });
    await repos.timeEvents.append({ taskId, track: 'human', event: 'pause', ts: localIso(2026, 8, 6, 9, 10) });
    await repos.timeEvents.append({ taskId, track: 'human', event: 'resume', ts: localIso(2026, 8, 6, 9, 11) });

    const active = await repos.timeEvents.activeSessions();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      taskId,
      accumulatedMs: 10 * 60 * 1000,
      running: true,
      lastEventAt: localIso(2026, 8, 6, 9, 11),
    });
  });
});

describe('I5：records running 标记 & active segments（前端单源防双计）', () => {
  it('recordsForDay：start 未 stop → record 带 running:true（含 I1-b 合成尾段）', async () => {
    const repos = createInMemoryRepos();
    const taskId = 20;
    await repos.timeEvents.append({ taskId, track: 'human', event: 'start', ts: localIso(2026, 8, 6, 20, 0) });

    const day = await repos.timeEvents.recordsForDay('2026-08-06', { asOf: localIso(2026, 8, 6, 21, 0) });
    expect(day).toHaveLength(1);
    expect(day[0].running).toBe(true);
    expect(day[0].durationMs).toBe(60 * 60 * 1000);
    expect(segSum(day[0])).toBe(day[0].durationMs);
  });

  it('recordsForDay：start→pause→resume→stop 完整会话 → record running:false', async () => {
    const repos = createInMemoryRepos();
    const taskId = 21;
    await repos.timeEvents.append({ taskId, track: 'agent', event: 'start', ts: localIso(2026, 8, 6, 10, 0) });
    await repos.timeEvents.append({ taskId, track: 'agent', event: 'pause', ts: localIso(2026, 8, 6, 10, 10) });
    await repos.timeEvents.append({ taskId, track: 'agent', event: 'resume', ts: localIso(2026, 8, 6, 10, 11) });
    await repos.timeEvents.append({ taskId, track: 'agent', event: 'stop', ts: localIso(2026, 8, 6, 10, 30) });

    const day = await repos.timeEvents.recordsForDay('2026-08-06');
    expect(day).toHaveLength(1);
    expect(day[0].running).toBe(false);
    // 10:00→10:10 + 10:11→10:30 = 29min
    expect(day[0].durationMs).toBe(29 * 60 * 1000);
    expect(segSum(day[0])).toBe(day[0].durationMs);
  });

  it('activeSessions：running 会话 segments=已完成段（不含当前运行尾段）', async () => {
    const repos = createInMemoryRepos();
    const taskId = 22;
    await repos.timeEvents.append({ taskId, track: 'human', event: 'start', ts: localIso(2026, 8, 6, 9, 0) });
    await repos.timeEvents.append({ taskId, track: 'human', event: 'pause', ts: localIso(2026, 8, 6, 9, 10) });
    await repos.timeEvents.append({ taskId, track: 'human', event: 'resume', ts: localIso(2026, 8, 6, 9, 11) });

    const active = await repos.timeEvents.activeSessions();
    expect(active).toHaveLength(1);
    expect(active[0].running).toBe(true);
    // 仅已完成段 [9:00→9:10]，不含 [9:11→now] 的当前运行尾段
    expect(active[0].segments).toEqual([
      { startedAt: localIso(2026, 8, 6, 9, 0), endedAt: localIso(2026, 8, 6, 9, 10), durationMs: 10 * 60 * 1000 },
    ]);
    // 运行中时长只由 active 单源呈现：accumulatedMs === sum(segments)
    expect(active[0].accumulatedMs).toBe(10 * 60 * 1000);
    expect(active[0].segments.reduce((s, x) => s + x.durationMs, 0)).toBe(active[0].accumulatedMs);
  });

  it('activeSessions：暂停会话 segments=全部已完成段', async () => {
    const repos = createInMemoryRepos();
    const taskId = 23;
    await repos.timeEvents.append({ taskId, track: 'human', event: 'start', ts: localIso(2026, 8, 6, 9, 0) });
    await repos.timeEvents.append({ taskId, track: 'human', event: 'pause', ts: localIso(2026, 8, 6, 9, 10) });
    await repos.timeEvents.append({ taskId, track: 'human', event: 'resume', ts: localIso(2026, 8, 6, 9, 11) });
    await repos.timeEvents.append({ taskId, track: 'human', event: 'pause', ts: localIso(2026, 8, 6, 9, 15) });

    const active = await repos.timeEvents.activeSessions();
    expect(active).toHaveLength(1);
    expect(active[0].running).toBe(false);
    expect(active[0].segments).toEqual([
      { startedAt: localIso(2026, 8, 6, 9, 0), endedAt: localIso(2026, 8, 6, 9, 10), durationMs: 10 * 60 * 1000 },
      { startedAt: localIso(2026, 8, 6, 9, 11), endedAt: localIso(2026, 8, 6, 9, 15), durationMs: 4 * 60 * 1000 },
    ]);
    expect(active[0].accumulatedMs).toBe(14 * 60 * 1000);
  });
});
