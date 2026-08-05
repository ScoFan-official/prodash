export default function TodoViewToggle({ view, onViewChange }) {
  return (
    <div className="view-toggle" role="tablist" aria-label="视图切换">
      <button type="button" role="tab" aria-selected={view === 'list'} onClick={() => onViewChange('list')}>
        列表
      </button>
      <button type="button" role="tab" aria-selected={view === 'quadrant'} onClick={() => onViewChange('quadrant')}>
        四象限
      </button>
    </div>
  )
}
