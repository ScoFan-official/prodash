// 前后端约定的脱敏规则：替换手机号、邮箱、身份证号，以及带疑似 token 查询参数的整条链接。
// 所有替换都返回新字符串，不修改传入的对象。

const PHONE_PATTERN = /\b1[3-9]\d{9}\b/g
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const ID_CARD_PATTERN = /\b\d{17}[\dXx]\b/g
const URL_PATTERN = /https?:\/\/[^\s，。；：！？、（）【】{}<>"'《》]+/g
// 鉴权相关参数名：精确匹配 + 明确的 _token/_secret/_key 下划线后缀匹配。
// 不做宽泛子串匹配，避免误伤 monkey、keyboard、secretary 等合法参数名。
const AUTH_PARAM_EXACT = ['token', 'access_token', 'secret', 'key']
const AUTH_PARAM_SUFFIXES = ['_token', '_secret', '_key']

const PHONE_PLACEHOLDER = '[手机号]'
const EMAIL_PLACEHOLDER = '[邮箱]'
const ID_CARD_PLACEHOLDER = '[身份证号]'
const SENSITIVE_URL_PLACEHOLDER = '[敏感链接]'

function isAuthParamName(name) {
  const lower = name.toLowerCase()
  if (AUTH_PARAM_EXACT.includes(lower)) return true
  return AUTH_PARAM_SUFFIXES.some((suffix) => lower.endsWith(suffix))
}

function hasTokenParam(url) {
  const queryIndex = url.indexOf('?')
  if (queryIndex === -1) return false
  const query = url.slice(queryIndex + 1).split('#')[0]
  return query.split(/[&;]/).some((pair) => {
    const [name] = pair.split('=')
    return isAuthParamName(name)
  })
}

export function sanitizeText(text) {
  let result = text
  const matches = []
  let changed = false

  // 敏感链接先处理，确保整条链接被替换而不是被内部字段部分脱敏
  result = result.replace(URL_PATTERN, (match) => {
    if (hasTokenParam(match)) {
      matches.push(match)
      changed = true
      return SENSITIVE_URL_PLACEHOLDER
    }
    return match
  })

  result = result.replace(PHONE_PATTERN, (match) => {
    matches.push(match)
    changed = true
    return PHONE_PLACEHOLDER
  })

  result = result.replace(EMAIL_PATTERN, (match) => {
    matches.push(match)
    changed = true
    return EMAIL_PLACEHOLDER
  })

  result = result.replace(ID_CARD_PATTERN, (match) => {
    matches.push(match)
    changed = true
    return ID_CARD_PLACEHOLDER
  })

  return { text: result, changed, matches }
}

export function sanitizeExtraWork(extraWork) {
  const value = {}
  const matches = []
  let changed = false
  for (const key of Object.keys(extraWork)) {
    const field = extraWork[key]
    if (typeof field !== 'string') {
      value[key] = field
      continue
    }
    const result = sanitizeText(field)
    value[key] = result.text
    changed = changed || result.changed
    matches.push(...result.matches)
  }
  return { value, changed, matches }
}

export function sanitizeReportPayload(payload) {
  const result = { ...payload }
  if (Array.isArray(result.completedTodos)) {
    result.completedTodos = result.completedTodos.map((todo) => ({
      ...todo,
      text:
        typeof todo.text === 'string' ? sanitizeText(todo.text).text : todo.text,
    }))
  }
  if (Array.isArray(result.pendingTodos)) {
    result.pendingTodos = result.pendingTodos.map((todo) => ({
      ...todo,
      text:
        typeof todo.text === 'string' ? sanitizeText(todo.text).text : todo.text,
    }))
  }
  if (result.extraWork) {
    result.extraWork = sanitizeExtraWork(result.extraWork).value
  }
  return result
}
