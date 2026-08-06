import { describe, expect, test } from 'vitest'
import { sanitizeText, sanitizeExtraWork, sanitizeReportPayload } from './sanitize'

describe('sanitizeText', () => {
  test('脱敏常见个人信息但保留普通文本', () => {
    const result = sanitizeText('联系 13812345678 或 a@example.com，编号 110101199001011234')
    expect(result.text).toContain('[手机号]')
    expect(result.text).toContain('[邮箱]')
    expect(result.text).toContain('[身份证号]')
    expect(result.changed).toBe(true)
  })

  test('返回匹配到的敏感原文', () => {
    const result = sanitizeText('电话 13812345678，邮箱 x@y.com')
    expect(result.matches).toEqual(['13812345678', 'x@y.com'])
  })

  test('无敏感内容时不改变文本', () => {
    const result = sanitizeText('今天完成了日报撰写')
    expect(result.changed).toBe(false)
    expect(result.matches).toEqual([])
    expect(result.text).toBe('今天完成了日报撰写')
  })

  test('替换带 token 查询参数的链接为整个链接', () => {
    const result = sanitizeText('查看 https://example.com/api?access_token=abc123 接口')
    expect(result.text).toContain('[敏感链接]')
    expect(result.text).not.toContain('example.com')
    expect(result.changed).toBe(true)
  })

  test('普通 URL 不被误替换', () => {
    const result = sanitizeText('文档见 https://example.com/docs/page?tab=1')
    expect(result.text).toBe('文档见 https://example.com/docs/page?tab=1')
    expect(result.changed).toBe(false)
    expect(result.matches).toEqual([])
  })

  test('不误伤包含 key 子串的普通参数（monkey、keyboard）', () => {
    const url = 'https://example.com/api?monkey=banana&keyboard=layout'
    const result = sanitizeText(`打开 ${url} 查看`)
    expect(result.text).toBe(`打开 ${url} 查看`)
    expect(result.changed).toBe(false)
    expect(result.matches).toEqual([])
  })

  test('不误伤包含 secret 子串的普通参数（secretary）', () => {
    const url = 'https://example.com/api?secretary=staff'
    const result = sanitizeText(`打开 ${url} 查看`)
    expect(result.text).toBe(`打开 ${url} 查看`)
    expect(result.changed).toBe(false)
    expect(result.matches).toEqual([])
  })

  test('替换以下划线后缀结尾的鉴权参数链接（api_key）', () => {
    const result = sanitizeText('查看 https://example.com/api?api_key=abc123 接口')
    expect(result.text).toContain('[敏感链接]')
    expect(result.text).not.toContain('example.com')
    expect(result.changed).toBe(true)
  })
})

describe('sanitizeExtraWork', () => {
  test('按字段脱敏并汇总 matches', () => {
    const result = sanitizeExtraWork({
      temporaryWork: '联系 13812345678',
      meetings: '正常内容',
      risks: '',
      tomorrowPlan: '发邮件到 a@example.com',
    })
    expect(result.changed).toBe(true)
    expect(result.matches).toEqual(['13812345678', 'a@example.com'])
    expect(result.value.temporaryWork).toContain('[手机号]')
    expect(result.value.meetings).toBe('正常内容')
    expect(result.value.tomorrowPlan).toContain('[邮箱]')
  })

  test('不修改原对象', () => {
    const extraWork = {
      temporaryWork: '电话 13812345678',
      meetings: '',
      risks: '',
      tomorrowPlan: '',
    }
    const snapshot = JSON.stringify(extraWork)
    sanitizeExtraWork(extraWork)
    expect(JSON.stringify(extraWork)).toBe(snapshot)
  })

  test('空补充内容脱敏后 unchanged', () => {
    const result = sanitizeExtraWork({
      temporaryWork: '',
      meetings: '',
      risks: '',
      tomorrowPlan: '',
    })
    expect(result.changed).toBe(false)
    expect(result.matches).toEqual([])
  })
})

describe('sanitizeReportPayload', () => {
  test('脱敏 completedTodos 与 pendingTodos 的 text 并保留其他字段', () => {
    const payload = {
      date: '2026-08-05',
      completedTodos: [
        {
          id: '1',
          text: '联系 13812345678',
          important: true,
          urgent: true,
          createdAt: '2026-08-05T08:00:00Z',
        },
      ],
      pendingTodos: [
        {
          id: '2',
          text: '回复 a@example.com',
          important: false,
          urgent: false,
          createdAt: '2026-08-05T09:00:00Z',
        },
      ],
      extraWork: { temporaryWork: '无', meetings: '', risks: '', tomorrowPlan: '' },
    }
    const result = sanitizeReportPayload(payload)
    expect(result.completedTodos[0].text).toContain('[手机号]')
    expect(result.pendingTodos[0].text).toContain('[邮箱]')
    expect(result.date).toBe('2026-08-05')
  })

  test('不修改原对象（嵌套不变性）', () => {
    const payload = {
      completedTodos: [
        {
          id: '1',
          text: '联系 13812345678',
          important: true,
          urgent: true,
          createdAt: '2026-08-05T08:00:00Z',
        },
      ],
      pendingTodos: [
        {
          id: '2',
          text: '普通任务',
          important: false,
          urgent: false,
          createdAt: '2026-08-05T09:00:00Z',
        },
      ],
      extraWork: { temporaryWork: '电话 13812345678', meetings: '', risks: '', tomorrowPlan: '' },
    }
    const snapshot = JSON.stringify(payload)
    const result = sanitizeReportPayload(payload)
    expect(JSON.stringify(payload)).toBe(snapshot)
    expect(result).not.toBe(payload)
    expect(result.completedTodos).not.toBe(payload.completedTodos)
    expect(result.pendingTodos).not.toBe(payload.pendingTodos)
    expect(result.extraWork).not.toBe(payload.extraWork)
  })

  test('缺失字段时安全处理', () => {
    expect(sanitizeReportPayload({})).toEqual({})
  })
})
