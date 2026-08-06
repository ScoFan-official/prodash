// @vitest-environment node
// 时区修正（F1）：日边界必须为「服务器本地时区」语义。
// 纯函数断言换算，不依赖系统 TZ 变量：显式传入东八区偏移（-480 分钟）模拟中国时区。

import { describe, it, expect } from 'vitest';
import {
  dayStartUtc,
  dayEndUtc,
  localDateOfInstant,
  localToday,
  nextDate,
  isValidDateStr,
} from './timeutil.js';

// 中国时区 UTC+8：getTimezoneOffset 语义下西正偏移为 -480 分钟
const CHINA = -480;

describe('本地时区日边界', () => {
  it('本地 2026-08-06 00:30（中国时区）完成的任务归属 2026-08-06 而非 2026-08-05', () => {
    // 本地 date 对象：墙钟 2026-08-06 00:30（getFullYear/getMonth/getDate 返回本地墙钟分量）
    const localRef = new Date(2026, 7, 6, 0, 30);
    // 中国时区（UTC+8）下，该本地时刻 == 该 UTC 时刻
    const isoInstant = '2026-08-05T16:30:00.000Z';

    const startUtc = dayStartUtc('2026-08-06', CHINA);
    const endUtc = dayEndUtc('2026-08-06', CHINA);
    expect(startUtc).toBe('2026-08-05T16:00:00.000Z');
    expect(endUtc).toBe('2026-08-06T16:00:00.000Z');

    // 完成时刻必须落在 [本地 00:00, 次日 00:00) 区间内 → 归属 2026-08-06
    expect(isoInstant >= startUtc && isoInstant < endUtc).toBe(true);
    expect(localDateOfInstant(isoInstant, CHINA)).toBe('2026-08-06');

    // 反向验证：由本地 date 对象推算当天日界
    const y = localRef.getFullYear();
    const m = String(localRef.getMonth() + 1).padStart(2, '0');
    const d = String(localRef.getDate()).padStart(2, '0');
    expect(dayStartUtc(`${y}-${m}-${d}`, CHINA)).toBe(startUtc);
  });

  it('本地日界前后边界归属正确', () => {
    // 本地 00:00 整恰好在当天内
    expect(localDateOfInstant('2026-08-05T16:00:00.000Z', CHINA)).toBe('2026-08-06');
    // 前 1ms 属于前一天
    expect(localDateOfInstant('2026-08-05T15:59:59.999Z', CHINA)).toBe('2026-08-05');
    // 本地 23:59:59.999 属于当天
    expect(localDateOfInstant('2026-08-06T15:59:59.999Z', CHINA)).toBe('2026-08-06');
    // 次日 00:00 整属于次日
    expect(localDateOfInstant('2026-08-06T16:00:00.000Z', CHINA)).toBe('2026-08-07');
  });

  it('西半球时区（如 UTC-5）下的换算同样正确', () => {
    const NY = 300; // UTC-5
    // 本地 2026-08-06 00:30（UTC-5）== 2026-08-06T05:30:00Z
    const isoInstant = '2026-08-06T05:30:00.000Z';
    expect(dayStartUtc('2026-08-06', NY)).toBe('2026-08-06T05:00:00.000Z');
    expect(isoInstant >= dayStartUtc('2026-08-06', NY) && isoInstant < dayEndUtc('2026-08-06', NY)).toBe(true);
    expect(localDateOfInstant(isoInstant, NY)).toBe('2026-08-06');
    // 前一天的 UTC 晚间时刻（本地 08-05 20:30）归属前一天
    expect(localDateOfInstant('2026-08-06T01:30:00.000Z', NY)).toBe('2026-08-05');
  });

  it('默认使用进程本地时区：localToday 与 now 的本地日历日一致', () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(localToday()).toBe(expected);
    // 任意 ISO 时刻经 localDateOfInstant 应回到其本地日历日
    expect(localDateOfInstant(now.toISOString())).toBe(expected);
  });

  it('nextDate/isValidDateStr 为日历运算，与时区无关', () => {
    expect(nextDate('2026-08-06')).toBe('2026-08-07');
    expect(nextDate('2026-12-31')).toBe('2027-01-01');
    expect(isValidDateStr('2026-02-29')).toBe(false);
    expect(isValidDateStr('2026-08-06')).toBe(true);
  });

  it('非法日期调用 dayStartUtc 抛错', () => {
    expect(() => dayStartUtc('not-a-date', CHINA)).toThrow();
  });
});
