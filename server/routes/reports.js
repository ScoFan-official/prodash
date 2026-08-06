// 日报 HTTP 路由（挂载前缀 /api/reports）。
// createReportsRouter({ repos, service })：repos 与 service 由入口/测试注入。
// 校验沿用分支精神：date 必须是 YYYY-MM-DD；extraWork 各字段必须是字符串且 ≤5000 字符。

import { Router } from 'express';
import { isValidDateStr } from '../repos/timeutil.js';

const EXTRA_KEYS = ['temporaryWork', 'meetings', 'risks', 'tomorrowPlan'];
const MAX_EXTRA_CHARS = 5000;

const ah = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

function validateExtraWork(extraWork) {
  if (extraWork === undefined || extraWork === null) return { value: null };
  if (typeof extraWork !== 'object' || Array.isArray(extraWork)) {
    return { error: 'extraWork must be an object' };
  }
  for (const key of EXTRA_KEYS) {
    const v = extraWork[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string') return { error: `${key} must be a string` };
    if (v.length > MAX_EXTRA_CHARS) {
      return { error: `${key} must be at most ${MAX_EXTRA_CHARS} characters` };
    }
  }
  return { value: extraWork };
}

export function createReportsRouter({ repos, service }) {
  const router = Router();

  // POST /api/reports/generate  body {date, extraWork?, includeDeleted?}
  router.post(
    '/generate',
    ah(async (req, res) => {
      const body = req.body || {};
      if (!isValidDateStr(body.date)) {
        return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      }
      const check = validateExtraWork(body.extraWork);
      if (check.error) return res.status(400).json({ error: check.error });
      const report = await service.generate(repos, {
        date: body.date,
        extraWork: check.value ?? undefined,
        includeDeleted: !!body.includeDeleted,
      });
      res.json(report);
    })
  );

  // POST /api/reports/:date/publish  补发/重试
  router.post(
    '/:date/publish',
    ah(async (req, res) => {
      const { date } = req.params;
      if (!isValidDateStr(date)) {
        return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      }
      const report = await service.publishReport(repos, date);
      if (!report) return res.status(404).json({ error: 'Not Found' });
      res.json(report);
    })
  );

  // PUT /api/reports/:date/extra  body {temporaryWork, meetings, risks, tomorrowPlan}
  router.put(
    '/:date/extra',
    ah(async (req, res) => {
      const { date } = req.params;
      if (!isValidDateStr(date)) {
        return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      }
      const check = validateExtraWork(req.body || {});
      if (check.error) return res.status(400).json({ error: check.error });
      const result = await service.saveExtra(repos, date, check.value ?? {});
      res.json(result);
    })
  );

  // GET /api/reports?date=YYYY-MM-DD → {report, extra}
  router.get(
    '/',
    ah(async (req, res) => {
      const { date } = req.query;
      if (date !== undefined) {
        if (!isValidDateStr(date)) {
          return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
        }
        const [report, extra] = await Promise.all([
          repos.reports.getByDate(date),
          repos.extras.getByDate(date),
        ]);
        return res.json({ report, extra });
      }
      // GET /api/reports → 历史列表
      const reports = await repos.reports.list();
      res.json(
        reports.map((r) => ({
          date: r.reportDate,
          status: r.status,
          docUrl: r.docUrl,
          version: r.version,
          updatedAt: r.updatedAt,
        }))
      );
    })
  );

  return router;
}
