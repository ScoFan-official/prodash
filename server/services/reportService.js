// 日报生成/发布服务。
// 工厂 createReportService({ difyClient, publisher }) 注入 Dify 客户端与发布器；
// repos 由调用方（路由/入口/调度器）传入，便于测试用 createInMemoryRepos。
// buildReportSource 从 app.js 的 GET /api/reports/source 重构而来，行为保持一致（仅日边界改为本地时区）。

import { dayStartUtc, dayEndUtc } from '../repos/timeutil.js';

const EMPTY_EXTRA = { temporaryWork: '', meetings: '', risks: '', tomorrowPlan: '' };

/**
 * 生成报告数据源：completed = completedAt ∈ [本地 00:00, 次日 00:00)
 * （includeDeleted=true 时含已删任务，标题 '已删除任务' 或原名）；
 * pending = createdAt ∈ 当天且 status='active'；
 * humanMs/agentMs 按当日 time-events records 聚合；totals 为当日全部时长。
 */
export async function buildReportSource(repos, { date, includeDeleted = false }) {
  const dayStart = dayStartUtc(date);
  const dayEnd = dayEndUtc(date);

  const [tasks, records] = await Promise.all([
    repos.tasks.list(),
    // asOf=生成时刻（I1-a）：运行中/尾巴会话只计到当前时刻，不虚增到窗口尾（最多午夜）
    repos.timeEvents.recordsForDay(date, { asOf: Date.now() }),
  ]);

  // 按任务聚合当日时长
  const agg = new Map();
  for (const r of records) {
    if (!agg.has(r.taskId)) agg.set(r.taskId, { humanMs: 0, agentMs: 0 });
    const a = agg.get(r.taskId);
    if (r.track === 'human') a.humanMs += r.durationMs;
    else if (r.track === 'agent') a.agentMs += r.durationMs;
  }
  const withDuration = (t) => {
    const a = agg.get(t.id) || { humanMs: 0, agentMs: 0 };
    return {
      id: t.id,
      title: t.title || '已删除任务',
      important: !!t.important,
      urgent: !!t.urgent,
      humanMs: a.humanMs,
      agentMs: a.agentMs,
    };
  };

  const completedTodos = tasks
    .filter(
      (t) =>
        t.completedAt &&
        t.completedAt >= dayStart &&
        t.completedAt < dayEnd &&
        (t.status === 'completed' || (includeDeleted && t.status === 'deleted'))
    )
    .map(withDuration);

  const pendingTodos = tasks
    .filter((t) => t.createdAt >= dayStart && t.createdAt < dayEnd && t.status === 'active')
    .map(withDuration);

  let totalHumanMs = 0;
  let totalAgentMs = 0;
  for (const a of agg.values()) {
    totalHumanMs += a.humanMs;
    totalAgentMs += a.agentMs;
  }

  return { date, includeDeleted, completedTodos, pendingTodos, totalHumanMs, totalAgentMs };
}

/** 毫秒 → 可读用时文本（供 LLM 直接引用，避免它自行换算毫秒值出错）。 */
export function formatDuration(ms) {
  const totalMinutes = Math.round(Number(ms || 0) / 60000);
  if (totalMinutes <= 0) return '不足 1 分钟';
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0 && m > 0) return `${h} 小时 ${m} 分钟`;
  if (h > 0) return `${h} 小时`;
  return `${m} 分钟`;
}

/** 组装 Dify workflow inputs。 */
function buildDifyInputs(source, extraWork) {
  const e = { ...EMPTY_EXTRA, ...(extraWork || {}) };
  const withTime = (t) => ({
    ...t,
    // 预格式化为可读文本，LLM 直接引用，不自行换算
    humanTime: formatDuration(t.humanMs),
    agentTime: formatDuration(t.agentMs),
    // 合计用时（人工+Agent），LLM 单值引用即可，避免它在双轨间挑选出错
    totalTime: formatDuration((t.humanMs || 0) + (t.agentMs || 0)),
  });
  return {
    report_date: source.date,
    completed_tasks: JSON.stringify(source.completedTodos.map(withTime)),
    pending_tasks: JSON.stringify(source.pendingTodos.map(withTime)),
    extra_work: JSON.stringify({
      temporaryWork: e.temporaryWork ?? '',
      meetings: e.meetings ?? '',
    }),
    risks: e.risks ?? '',
    tomorrow_plan: e.tomorrowPlan ?? '',
    time_summary: JSON.stringify({
      totalHumanMs: source.totalHumanMs,
      totalAgentMs: source.totalAgentMs,
      totalHumanTime: formatDuration(source.totalHumanMs),
      totalAgentTime: formatDuration(source.totalAgentMs),
    }),
  };
}

export function createReportService({ difyClient, publisher }) {
  /**
   * 发布报告（供 generate 与补发端点复用）。
   * 读 report → publisher.publish → upsert published/docUrl/docNodeId；
   * 任何异常 → 标记 publish_failed，不向上抛给调用方。
   * @returns {Promise<object|null>} 更新后的 report 行；日期不存在返回 null。
   */
  async function publishReport(repos, date) {
    const report = await repos.reports.getByDate(date);
    if (!report) return null;
    try {
      const { nodeId, url } = await publisher.publish({
        date,
        title: `日报 ${date}`,
        content: report.content,
        existingNodeId: report.docNodeId,
      });
      return await repos.reports.upsert({
        date,
        content: report.content,
        status: 'published',
        // dws doc update 不返回 URL（只返回 nodeId）：新值为空时保留已有 docUrl/docNodeId，
        // 避免覆盖发布后把真实链接清成 null
        docUrl: url ?? report.docUrl,
        docNodeId: nodeId ?? report.docNodeId,
        includeDeleted: report.includeDeleted,
        version: report.version,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[report-service] publish failed for ${date}:`, err?.message || err);
      return await repos.reports.upsert({
        date,
        content: report.content,
        status: 'publish_failed',
        includeDeleted: report.includeDeleted,
        version: report.version,
      });
    }
  }

  /**
   * 生成日报：buildReportSource → Dify inputs → runWorkflow → reports.upsert
   * （draft，version+1）→ 自动 publishReport。
   * @returns {Promise<object>} 最终 report 行（published 或 publish_failed）。
   */
  async function generate(repos, { date, extraWork, includeDeleted = false }) {
    const source = await buildReportSource(repos, { date, includeDeleted });
    const inputs = buildDifyInputs(source, extraWork);
    const { report: content } = await difyClient.runWorkflow(inputs);

    const existing = await repos.reports.getByDate(date);
    // C1：重生成必须保留旧 docNodeId/docUrl，否则 mysql upsert 会把已发布行的链接清空，
    // 导致 DwsCliPublisher 走 create 新建文档而非 update 覆盖旧文档。
    await repos.reports.upsert({
      date,
      content,
      status: 'draft',
      includeDeleted,
      version: (existing?.version ?? 0) + 1,
      docUrl: existing?.docUrl ?? null,
      docNodeId: existing?.docNodeId ?? null,
    });
    // 生成后自动发布；publishReport 内部吞掉发布异常（publish_failed）
    return publishReport(repos, date);
  }

  /**
   * 保存额外工作（机制 b）：
   * 先 extras.upsert；若当天已有 version>0 的 report → 用新 extra 重新 generate
   * （覆盖当天文档）并返回 { report, regenerated: true }；否则仅保存返回
   * { report: null, regenerated: false }。
   */
  async function saveExtra(repos, date, extra) {
    await repos.extras.upsert(date, extra);
    const report = await repos.reports.getByDate(date);
    if (report && report.version > 0) {
      const regenerated = await generate(repos, {
        date,
        extraWork: extra,
        includeDeleted: report.includeDeleted,
      });
      return { report: regenerated, regenerated: true };
    }
    return { report: null, regenerated: false };
  }

  return { buildReportSource, generate, publishReport, saveExtra };
}
