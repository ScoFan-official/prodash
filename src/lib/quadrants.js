export const QUADRANT_ORDER = [
  'important-urgent',
  'important-not-urgent',
  'not-important-urgent',
  'not-important-not-urgent',
]

export const QUADRANTS = {
  'important-urgent': { title: '重要·紧急', hint: '立即做' },
  'important-not-urgent': { title: '重要·不紧急', hint: '计划做' },
  'not-important-urgent': { title: '不重要·紧急', hint: '快速处理' },
  'not-important-not-urgent': { title: '不重要·不紧急', hint: '尽量少做' },
}

export function getQuadrantKey(important, urgent) {
  if (important && urgent) return 'important-urgent'
  if (important) return 'important-not-urgent'
  if (urgent) return 'not-important-urgent'
  return 'not-important-not-urgent'
}
