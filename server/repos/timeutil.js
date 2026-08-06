// 时间处理约定（JS 侧与 SQL 之间的唯一转换层）
// - JS 侧（仓库返回、路由返回）统一使用 ISO 8601 UTC 字符串，如 '2026-08-06T12:00:00.000Z'。
// - MySQL DATETIME(3) 列按 UTC 墙钟写入（无时区），读取时（dateStrings=true）得到
//   'YYYY-MM-DD HH:MM:SS.sss' 字符串，按 UTC 墙钟解释回 ISO。
// - 日边界采用「服务器本地时区」语义："某一天" = [本地 00:00, 次日 00:00)。
//   存储仍为 UTC/ISO；用 dayStartUtc/dayEndUtc 把本地日换算成 UTC 时刻用于 SQL/内存比较。
//   （F1：若按 UTC 墙钟切日，中国时区下本地 00:30 完成的任务会被算到前一天。）

const SQL_DT_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,3})?$/;

/**
 * 将「数字毫秒 / Date / ISO 字符串」统一归一化为 ISO 字符串。
 * @param {number|Date|string} ts
 * @returns {string} 'YYYY-MM-DDTHH:mm:ss.sssZ'
 * @throws {Error} 非法输入
 */
export function parseTs(ts) {
  if (ts === undefined || ts === null) throw new Error('ts is required');
  if (typeof ts === 'number') return new Date(ts).toISOString();
  if (ts instanceof Date) return ts.toISOString();
  if (typeof ts === 'string') {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) throw new Error(`invalid ts: ${ts}`);
    return d.toISOString();
  }
  throw new Error(`invalid ts: ${ts}`);
}

/**
 * ISO 字符串 -> MySQL DATETIME(3) 字面量（UTC 墙钟），如
 * '2026-08-06T12:00:00.123Z' -> '2026-08-06 12:00:00.123'
 */
export function isoToSql(iso) {
  return iso.replace('T', ' ').replace('Z', '').slice(0, 23);
}

/**
 * MySQL 读取值（Date / 'YYYY-MM-DD HH:MM:SS.sss' 字符串 / ISO 字符串 / 数字）-> ISO 字符串。
 * 无法识别时返回 null。
 */
export function toIso(value) {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  const s = String(value);
  if (s.endsWith('Z')) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (SQL_DT_RE.test(s)) {
    const d = new Date(`${s.replace(' ', 'T')}Z`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** 取 ISO 字符串的日期部分 'YYYY-MM-DD'（UTC）。 */
export function dateOnly(iso) {
  return iso.slice(0, 10);
}

/** 'YYYY-MM-DD' -> 次日 'YYYY-MM-DD'（纯日历运算，与时区无关）。 */
export function nextDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** 校验 'YYYY-MM-DD' 格式。 */
export function isValidDateStr(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === dateStr;
}

/**
 * 本地时区下某日 00:00 对应的 UTC ISO 时刻。
 *
 * tzOffsetMinutes 为「本地相对 UTC 的偏移分钟，西为正」（如东八区 UTC+8 为 -480）；
 * 显式传入时走固定偏移换算（纯函数，给定相同输入结果唯一，不依赖系统 TZ 变量）；
 * 不传时用进程本地时区直接构造（DST 感知），保证运行时即「服务器本地时区」语义。
 *
 * @param {string} dateStr 'YYYY-MM-DD'
 * @param {number} [tzOffsetMinutes] 可选本地偏移分钟
 */
export function dayStartUtc(dateStr, tzOffsetMinutes) {
  if (!isValidDateStr(dateStr)) throw new Error(`invalid date: ${dateStr}`);
  const [y, m, d] = dateStr.split('-').map(Number);
  if (tzOffsetMinutes === undefined) {
    return new Date(y, m - 1, d).toISOString();
  }
  return new Date(Date.UTC(y, m - 1, d) + tzOffsetMinutes * 60000).toISOString();
}

/** 本地时区下某日 24:00（次日 00:00）对应的 UTC ISO 时刻。 */
export function dayEndUtc(dateStr, tzOffsetMinutes) {
  return dayStartUtc(nextDate(dateStr), tzOffsetMinutes);
}

/**
 * UTC ISO 时刻 -> 其所属的本地日 'YYYY-MM-DD'。
 * tzOffsetMinutes 含义同 dayStartUtc（getTimezoneOffset 语义：UTC = local + offset，
 * 故 UTC 转本地墙钟为 instant - offset*60000）；不传时使用进程本地时区。
 */
export function localDateOfInstant(iso, tzOffsetMinutes) {
  if (tzOffsetMinutes === undefined) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const shifted = new Date(new Date(iso).getTime() - tzOffsetMinutes * 60000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 服务器本地时区的「今天」'YYYY-MM-DD'。 */
export function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
