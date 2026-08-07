// 待办行双轨计时控制：human / agent 两组按钮与累计时长展示。
// 纯展示组件：状态来自 summary（useTaskTimers.getTodoSummary），动作通过回调上抛。

import { Play, Pause, Square } from 'lucide-react'
import cn from 'classnames'
import IconButton from './primitives/IconButton'
import Button from './primitives/Button'
import Badge from './primitives/Badge'
import { TRACKS } from '../lib/timeStore'

const TRACK_LABELS = {
  human: '人工',
  agent: 'Agent',
}

export function formatMinutes(ms) {
  return Math.floor(ms / 60000)
}

function TrackControl({
  track,
  state,
  elapsedMs,
  disabled,
  onStart,
  onPause,
  onResume,
  onStop,
}) {
  const isRunning = state === 'running'
  const isActive = state === 'running' || state === 'paused'
  const label = TRACK_LABELS[track]
  return (
    <div className="timer-track" data-track={track}>
      <div className="timer-track__meta">
        <span
          className={cn('timer-track__dot', `timer-track__dot--${track}`, {
            'is-running': isRunning,
          })}
        />
        <span className="timer-track__label">{label}</span>
        <Badge variant="default" className="timer-track__elapsed">
          {formatMinutes(elapsedMs)} 分钟
        </Badge>
      </div>
      <div className="timer-track__actions">
        {!isActive && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onStart(track)}
            disabled={disabled}
            aria-label={`开始${label}计时`}
          >
            <Play size={14} /> 开始
          </Button>
        )}
        {isActive && !isRunning && (
          <>
            <IconButton
              icon={Play}
              label={`继续${label}计时`}
              onClick={() => onResume(track)}
              disabled={disabled}
            />
            <IconButton
              icon={Square}
              label={`停止${label}计时`}
              onClick={() => onStop(track)}
            />
          </>
        )}
        {isRunning && (
          <>
            <IconButton
              icon={Pause}
              label={`暂停${label}计时`}
              onClick={() => onPause(track)}
            />
            <IconButton
              icon={Square}
              label={`停止${label}计时`}
              onClick={() => onStop(track)}
            />
          </>
        )}
      </div>
    </div>
  )
}

export default function TaskTimerControls({
  summary,
  onStart,
  onPause,
  onResume,
  onStop,
  disabled = false,
}) {
  return (
    <div className="task-timer-controls" aria-label="双轨计时控制">
      {TRACKS.map((track) => {
        const entry = summary?.[track] ?? { active: false, running: false, elapsedMs: 0 }
        const state = entry.running ? 'running' : entry.active ? 'paused' : 'idle'
        return (
          <TrackControl
            key={track}
            track={track}
            state={state}
            elapsedMs={entry.elapsedMs}
            disabled={disabled}
            onStart={onStart}
            onPause={onPause}
            onResume={onResume}
            onStop={onStop}
          />
        )
      })}
    </div>
  )
}
