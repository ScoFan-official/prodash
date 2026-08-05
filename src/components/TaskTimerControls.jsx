// 待办行双轨计时控制：human / agent 两组按钮与累计时长展示。
// 纯展示组件：状态来自 summary（useTaskTimers.getTodoSummary），动作通过回调上抛。

import { TRACKS } from '../lib/timeStore'

const TRACK_LABELS = {
  human: '人工',
  agent: 'Agent',
}

export function formatMinutes(ms) {
  return Math.floor(ms / 60000)
}

function actionName(prefix, track) {
  return `${prefix}${TRACK_LABELS[track]}计时`
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
        const statusClass = entry.running
          ? 'is-running'
          : entry.active
            ? 'is-paused'
            : 'is-idle'
        const statusText = entry.running ? '运行中' : entry.active ? '已暂停' : ''
        return (
          <div key={track} className="timer-track" data-track={track}>
            <span className="timer-track-label">{TRACK_LABELS[track]}</span>
            {statusText && (
              <span className={`timer-track-status ${statusClass}`} aria-label={`${TRACK_LABELS[track]}${statusText}`}>
                {statusText}
              </span>
            )}
            {!entry.active && (
              <button
                type="button"
                onClick={() => onStart(track)}
                aria-label={actionName('开始', track)}
                disabled={disabled}
              >
                开始
              </button>
            )}
            {entry.active && !entry.running && (
              <>
                <button
                  type="button"
                  onClick={() => onResume(track)}
                  aria-label={actionName('继续', track)}
                  disabled={disabled}
                >
                  继续
                </button>
                <button
                  type="button"
                  onClick={() => onStop(track)}
                  aria-label={actionName('停止', track)}
                >
                  停止
                </button>
              </>
            )}
            {entry.active && entry.running && (
              <>
                <button
                  type="button"
                  onClick={() => onPause(track)}
                  aria-label={actionName('暂停', track)}
                >
                  暂停
                </button>
                <button
                  type="button"
                  onClick={() => onStop(track)}
                  aria-label={actionName('停止', track)}
                >
                  停止
                </button>
              </>
            )}
            <span className="timer-track-elapsed">{formatMinutes(entry.elapsedMs)} 分钟</span>
          </div>
        )
      })}
    </div>
  )
}
