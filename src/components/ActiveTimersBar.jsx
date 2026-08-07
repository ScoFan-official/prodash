import { useState } from 'react'
import { ChevronDown, ChevronUp, Square } from 'lucide-react'
import cn from 'classnames'
import Card from './primitives/Card'
import Button from './primitives/Button'
import IconButton from './primitives/IconButton'
import { getElapsedMs, DELETED_TODO_LABEL } from '../lib/timeStore'
import { formatDuration } from '../lib/timeStats'

const TRACK_LABELS = {
  human: '人工',
  agent: 'Agent',
}

/**
 * 待办页顶部活动计时状态条。
 *
 * 默认折叠：显示正在计时任务数量与简短名称。
 * 点击展开：列出全部活动计时任务（含暂停）的轨道、任务名与累计时长。
 */
export default function ActiveTimersBar({ active, todos, onStop }) {
  const [expanded, setExpanded] = useState(false)
  // todo.id 为数字（后端 BIGINT），timeStore 条目的 todoId 统一为 String，映射键归一为 String。
  const todoById = new Map((todos ?? []).map((todo) => [String(todo.id), todo]))
  const now = Date.now()

  const items = Object.values(active ?? {})
    .filter((entry) => entry && (entry.running || entry.accumulatedMs > 0 || entry.segments?.length > 0))
    .map((entry) => {
      const todo = todoById.get(entry.todoId)
      return {
        key: entry.id || `${entry.todoId}:${entry.track}`,
        todoId: entry.todoId,
        title: todo?.text ?? DELETED_TODO_LABEL,
        track: entry.track,
        running: entry.running === true,
        elapsedMs: getElapsedMs(entry, now),
      }
    })
    .sort((a, b) => b.elapsedMs - a.elapsedMs)

  const runningItems = items.filter((item) => item.running)
  const runningCount = runningItems.length
  const pausedCount = items.length - runningCount

  if (items.length === 0) {
    return (
      <Card className="active-timers-bar active-timers-bar--empty">
        <span className="active-timers-bar__summary">暂无计时任务</span>
      </Card>
    )
  }

  const shortNames = runningItems
    .slice(0, 2)
    .map((item) => item.title)
    .join('、')

  return (
    <Card className={cn('active-timers-bar', { 'is-expanded': expanded })}>
      <Button
        variant="ghost"
        className="active-timers-bar__summary active-timers-bar__toggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={expanded ? '收起计时详情' : '展开计时详情'}
      >
        <span className="active-timers-bar__count">
          {runningCount} 个任务正在计时
        </span>
        {pausedCount > 0 && (
          <span className="active-timers-bar__paused">，{pausedCount} 个暂停</span>
        )}
        {!expanded && shortNames && (
          <span className="active-timers-bar__names"> · {shortNames}{runningItems.length > 2 && ' 等'}</span>
        )}
        <span className="active-timers-bar__chevron" aria-hidden="true">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </Button>
      {expanded && (
        <div className="active-timers-bar__details active-timers-bar__content">
          {items.map((item) => (
            <div
              key={item.key}
              className={cn('active-timers-bar__item', 'active-timer-item', {
                'is-running': item.running,
              })}
            >
              <span className="active-timers-bar__title">{item.title}</span>
              <span className="active-timers-bar__status" aria-label={item.running ? '运行中' : '已暂停'}>
                {item.running ? '运行中' : '已暂停'}
              </span>
              <span className="active-timers-bar__track">{TRACK_LABELS[item.track]}</span>
              <span className="active-timers-bar__time">{formatDuration(item.elapsedMs)}</span>
              {onStop && (
                <IconButton
                  icon={Square}
                  label={`停止 ${item.title} 的${TRACK_LABELS[item.track]}计时`}
                  onClick={() => onStop(item.todoId, item.track)}
                  className="active-timers-bar__stop"
                />
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
