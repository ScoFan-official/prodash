// 事件 -> 会话重构（内存实现与 MySQL 实现共用，保证语义一致）
//
// 输入：事件数组，每项 { id, taskId, track, event, ts(ISO), durationMs }
// 输出：会话数组，每项
//   { id, taskId, todoId, track, startedAt, endedAt, durationMs,
//     segments: [{ startedAt, endedAt, durationMs }], running }
// - 会话按 (taskId, track) 分组，事件按 ts 升序（同 ts 按 id 升序）。
// - 'start' 开启新会话；'pause'/'stop' 结束当前段；'resume' 开启新段。
// - endedAt 取会话最后一个事件的 ts；running=最后事件是 start/resume。
// - 窗口内出现没有 'start' 的事件（跨日会话的尾巴）时，以第一个事件作为会话起点。
//
// 窗口切分（I1）：传入 { windowStart, windowEnd }（ISO，本地日界）时，
//   对跨日边界做日窗口归因，避免"两天各计 0ms"：
//   - 会话在窗口内有 start、仍 running（延续过午夜）：窗口内计 [startedAt, windowEnd]；
//   - 会话从窗口外延续进来（窗口内无 start 的 tail）：窗口内以 [windowStart, 最后事件] 计，
//     若会话在窗口起点处于运行中则另加 [windowStart, 首事件)。
//   - 正常 start→stop 完整会话行为不变。
//
// durationMs 说明：time_events.duration_ms 列仅信息性（增量快照），不参与聚合；
//   聚合一律以事件 ts 重建会话段长（applyEvent/finalize 计算）。
//
// asOf 截断（I1-a）：opts.asOf（epoch ms 或 ISO）为"归因时刻"（默认 Date.now()）。
//   运行中/尾巴会话的窗口尾取 min(windowEnd, asOf)，避免把仍在进行的会话
//   从生成时刻一路计到窗口尾（最多午夜）而高估当日时长。
// 合成段补齐（I1-b）：窗口切分产生的段（[currentStart, 截断尾]、[windowStart, 首事件]）
//   一律真实写入 segments，保证 sum(segments) === durationMs 恒成立。
//
// running 标记（I5，门3）：每条 record 恒带 running（运行中 true / 已停止 false），
//   供前端把运行中会话排除出 records 聚合，改由 active 单源呈现运行中时长；
//   activeSessions 额外输出 segments（仅已完成段，不含当前运行尾段）。

import { parseTs } from './timeutil.js';

const EVENT_RANK = { start: 0, pause: 1, resume: 2, stop: 3 };

export function buildSessions(events, opts = {}) {
  const { windowStart, windowEnd } = opts;
  const byKey = new Map();
  for (const e of events) {
    const key = `${e.taskId}|${e.track}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(e);
  }

  const sessions = [];
  for (const list of byKey.values()) {
    list.sort((a, b) => (a.ts === b.ts ? a.id - b.id : a.ts < b.ts ? -1 : 1));

    const first = list[0];
    const taskId = first.taskId;
    const track = first.track;
    let session = null;

    for (const e of list) {
      if (e.event === 'start') {
        if (session) sessions.push(finalize(session, opts));
        session = {
          id: e.id,
          taskId,
          track,
          startedAt: e.ts,
          segments: [],
          running: true,
          currentStart: e.ts,
          lastEventAt: e.ts,
          lastEvent: 'start',
          hadStart: true,
          activeAtWindowStart: false,
        };
        continue;
      }
      if (!session) {
        // 窗口内首事件不是 start：跨日会话的残留事件
        const running = e.event === 'resume';
        session = {
          id: e.id,
          taskId,
          track,
          startedAt: e.ts,
          segments: [],
          running,
          currentStart: running ? e.ts : null,
          lastEventAt: e.ts,
          lastEvent: e.event,
          hadStart: false,
          // 首事件是 pause/stop 说明会话在窗口起点（如午夜）处于运行中
          activeAtWindowStart: e.event !== 'resume',
        };
      }
      applyEvent(session, e);
    }
    if (session) sessions.push(finalize(session, opts));
  }

  // 稳定排序：按 taskId 升序，便于测试断言
  sessions.sort((a, b) => (a.taskId === b.taskId ? EVENT_RANK[a.track] - EVENT_RANK[b.track] || a.startedAt.localeCompare(b.startedAt) : a.taskId - b.taskId));
  return sessions;
}

function applyEvent(session, e) {
  switch (e.event) {
    case 'pause':
    case 'stop':
      if (session.running) {
        const dur = Math.max(0, new Date(e.ts).getTime() - new Date(session.currentStart).getTime());
        session.segments.push({ startedAt: session.currentStart, endedAt: e.ts, durationMs: dur });
        session.running = false;
      }
      break;
    case 'resume':
      if (!session.running) {
        session.currentStart = e.ts;
        session.running = true;
      }
      break;
    default:
      break;
  }
  session.lastEventAt = e.ts;
  session.lastEvent = e.event;
}

function finalize(session, opts) {
  const { windowStart, windowEnd, asOf } = opts || {};
  // segments 后续会被窗口切分产生的合成段补齐（I1-b），本地持有一份再覆盖输出
  const segments = session.segments.slice();
  let startedAt = session.startedAt;
  let endedAt = session.lastEventAt;
  let durationMs = segments.reduce((sum, s) => sum + s.durationMs, 0);

  if (windowStart && windowEnd) {
    const startMs = new Date(windowStart).getTime();
    const endMs = new Date(windowEnd).getTime();
    // asOf 截断（I1-a）：运行中/尾巴会话的窗口尾最多计到 asOf（生成时刻/查询时刻），
    // 避免把"仍在进行的会话"从生成时刻一路高估到窗口尾（最多午夜）。
    const asOfMs = asOf === undefined ? Date.now() : new Date(parseTs(asOf)).getTime();
    const effEndMs = Math.min(endMs, asOfMs);
    const effEndIso = new Date(effEndMs).toISOString();

    if (!session.hadStart) {
      // 跨日尾巴：会话从上一日延续进窗口。窗口内以 [windowStart, 最后事件] 计；
      // 若会话在窗口起点处于运行中则另加 [windowStart, 首事件)（合成段真实入 segments）；
      // 仍在运行则补 [currentStart, min(windowEnd, asOf))。
      startedAt = windowStart;
      if (session.activeAtWindowStart) {
        const firstMs = Math.min(effEndMs, Math.max(startMs, new Date(session.startedAt).getTime()));
        const segMs = Math.max(0, firstMs - startMs);
        if (segMs > 0) {
          // 该段在时间轴上早于窗口内所有真实事件，unshift 保证 segments 仍按时间升序
          segments.unshift({ startedAt: windowStart, endedAt: new Date(firstMs).toISOString(), durationMs: segMs });
        }
      }
      if (session.running && session.currentStart) {
        const currentStartMs = new Date(session.currentStart).getTime();
        const segMs = Math.max(0, effEndMs - currentStartMs);
        if (segMs > 0) {
          segments.push({ startedAt: session.currentStart, endedAt: effEndIso, durationMs: segMs });
        }
        endedAt = effEndIso;
      }
    } else if (session.running) {
      // start 在窗口内、仍运行（会话延续过午夜）：[currentStart, min(windowEnd, asOf)) 计入
      const currentStartMs = new Date(session.currentStart).getTime();
      const segMs = Math.max(0, effEndMs - currentStartMs);
      if (segMs > 0) {
        segments.push({ startedAt: session.currentStart, endedAt: effEndIso, durationMs: segMs });
      }
      endedAt = effEndIso;
    }
    durationMs = segments.reduce((sum, s) => sum + s.durationMs, 0);
  }

  const { currentStart, hadStart, activeAtWindowStart, ...rest } = session;
  return {
    ...rest,
    startedAt,
    endedAt,
    durationMs,
    segments,
  };
}
