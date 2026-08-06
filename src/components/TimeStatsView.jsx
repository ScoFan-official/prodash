import { aggregateToday, formatDuration, formatPercent } from '../lib/timeStats'
import { QUADRANTS, getQuadrantKey } from '../lib/quadrants'

const QUADRANT_KEYS = [
  'important-urgent',
  'important-not-urgent',
  'not-important-urgent',
  'not-important-not-urgent',
]

function getSlices(items, total) {
  let cumulative = 0
  return items.map((item) => {
    const value = total > 0 ? (item.totalMs / total) * 100 : 0
    const slice = {
      ...item,
      value,
      offset: cumulative,
    }
    cumulative += value
    return slice
  })
}

function PieChart({ data, total }) {
  const slices = getSlices(data, total)
  return (
    <div className="pie-chart">
      <svg
        viewBox="0 0 100 100"
        className="pie-chart__svg"
        role="img"
        aria-label="按任务分类占比"
      >
        <g transform="rotate(-90 50 50)">
          {slices.map((slice) => (
            <circle
              key={slice.key}
              cx="50"
              cy="50"
              r="15.9155"
              fill="transparent"
              stroke={slice.color}
              strokeWidth="32"
              strokeDasharray={`${slice.value} ${100 - slice.value}`}
              strokeDashoffset={-slice.offset}
            />
          ))}
        </g>
      </svg>
      <ul className="pie-chart__legend">
        {slices.map((slice) => (
          <li key={slice.key}>
            <span
              className="pie-chart__dot"
              style={{ background: slice.color }}
            />
            <span className="pie-chart__label">{slice.label}</span>
            <span className="pie-chart__percent">
              {formatPercent(slice.totalMs, total)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function QuadrantDistribution({ todos, byCategory, totalMs }) {
  const categoryMap = new Map(byCategory.map((c) => [c.key, c]))
  const items = QUADRANT_KEYS.map((key) => {
    const taskCount = todos.filter(
      (todo) => getQuadrantKey(todo.important, todo.urgent) === key,
    ).length
    const category = categoryMap.get(key)
    return {
      key,
      label: QUADRANTS[key].title,
      color: category?.color ?? 'var(--text-muted)',
      taskCount,
      totalMs: category?.totalMs ?? 0,
    }
  })

  return (
    <ol className="stats-ranking quadrant-distribution">
      {items.map((item) => (
        <li key={item.key} className="stats-ranking__item">
          <span
            className="pie-chart__dot"
            style={{ background: item.color }}
          />
          <span className="stats-ranking__name">
            {item.label}（{item.taskCount} 个任务）
          </span>
          <span className="stats-ranking__duration">
            {formatDuration(item.totalMs)}
          </span>
          <span className="stats-ranking__percent">
            {formatPercent(item.totalMs, totalMs)}
          </span>
          <div className="stats-ranking__bar">
            <span
              className="stats-ranking__fill"
              style={{
                width: formatPercent(item.totalMs, totalMs),
                background: item.color,
              }}
            />
          </div>
        </li>
      ))}
    </ol>
  )
}

function AgentEfficiency({ byTask, totalMs, totalAgentMs }) {
  const agentItems = [...byTask]
    .filter((task) => task.agentMs > 0)
    .sort((a, b) => b.agentMs - a.agentMs)

  return (
    <>
      <div className="agent-share">
        <span className="agent-share__label">
          Agent 占总工时 {formatPercent(totalAgentMs, totalMs)}
        </span>
        <div className="agent-share__bar">
          <span
            className="agent-share__fill"
            style={{ width: formatPercent(totalAgentMs, totalMs) }}
          />
        </div>
      </div>
      <ol className="stats-ranking agent-efficiency">
        {agentItems.map((task) => (
          <li key={task.todoId} className="stats-ranking__item">
            <span className="stats-ranking__name">Agent · {task.title}</span>
            <span className="stats-ranking__duration">
              Agent {formatDuration(task.agentMs)}
            </span>
            <span className="stats-ranking__percent">
              {formatPercent(task.agentMs, task.totalMs)}
            </span>
            <div className="stats-ranking__bar agent-efficiency__bar">
              <span
                className="stats-ranking__fill agent-efficiency__fill--agent"
                style={{
                  width: formatPercent(task.agentMs, task.totalMs),
                }}
              />
            </div>
            <span className="stats-ranking__sub">
              人工 {formatDuration(task.humanMs)} · Agent {formatDuration(task.agentMs)}
            </span>
          </li>
        ))}
      </ol>
    </>
  )
}

export default function TimeStatsView({ active, records, todos }) {
  const stats = aggregateToday({ active, records }, todos, Date.now())
  const { date, totalHumanMs, totalAgentMs, totalMs, byTask, byCategory } = stats

  return (
    <section className="time-stats-view" aria-label="统计视图">
      <header className="time-stats-view__header">
        <h2>今日工时统计</h2>
        <span className="time-stats-view__date">{date}</span>
      </header>

      <div className="stats-summary">
        <div className="stat-card stat-card--total">
          <span className="stat-card__label">今日总工时</span>
          <span className="stat-card__value">{formatDuration(totalMs)}</span>
        </div>
        <div className="stat-card stat-card--human">
          <span className="stat-card__label">人工</span>
          <span className="stat-card__value">{formatDuration(totalHumanMs)}</span>
          <span className="stat-card__percent">
            {formatPercent(totalHumanMs, totalMs)}
          </span>
          <div className="stat-card__bar">
            <span
              className="stat-card__fill"
              style={{ width: formatPercent(totalHumanMs, totalMs) }}
            />
          </div>
        </div>
        <div className="stat-card stat-card--agent">
          <span className="stat-card__label">Agent</span>
          <span className="stat-card__value">{formatDuration(totalAgentMs)}</span>
          <span className="stat-card__percent">
            {formatPercent(totalAgentMs, totalMs)}
          </span>
          <div className="stat-card__bar">
            <span
              className="stat-card__fill"
              style={{ width: formatPercent(totalAgentMs, totalMs) }}
            />
          </div>
        </div>
      </div>

      <div className="stats-section">
        <h3 className="stats-section__title">按任务排行</h3>
        {byTask.length === 0 ? (
          <p className="stats-empty">今日暂无工时记录</p>
        ) : (
          <ol className="stats-ranking">
            {byTask.map((task, index) => (
              <li key={task.todoId} className="stats-ranking__item">
                <span className="stats-ranking__rank">{index + 1}</span>
                <span className="stats-ranking__name">{task.title}</span>
                <span className="stats-ranking__duration">
                  {formatDuration(task.totalMs)}
                </span>
                <span className="stats-ranking__percent">
                  {formatPercent(task.totalMs, totalMs)}
                </span>
                <div className="stats-ranking__bar">
                  <span
                    className="stats-ranking__fill"
                    style={{
                      width: formatPercent(task.totalMs, byTask[0].totalMs),
                    }}
                  />
                </div>
                <span className="stats-ranking__sub">
                  人工 {formatDuration(task.humanMs)} · Agent {formatDuration(task.agentMs)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="stats-section">
        <h3 className="stats-section__title">按任务分类占比</h3>
        {byCategory.length === 0 ? (
          <p className="stats-empty">今日暂无分类数据</p>
        ) : (
          <PieChart data={byCategory} total={totalMs} />
        )}
      </div>

      <div className="stats-section">
        <h3 className="stats-section__title">象限分布统计</h3>
        {totalMs === 0 ? (
          <p className="stats-empty">今日暂无象限分布数据</p>
        ) : (
          <QuadrantDistribution
            todos={todos}
            byCategory={byCategory}
            totalMs={totalMs}
          />
        )}
      </div>

      <div className="stats-section">
        <h3 className="stats-section__title">Agent 效率统计</h3>
        {totalMs === 0 ? (
          <p className="stats-empty">今日暂无Agent效率数据</p>
        ) : (
          <AgentEfficiency
            byTask={byTask}
            totalMs={totalMs}
            totalAgentMs={totalAgentMs}
          />
        )}
      </div>
    </section>
  )
}
