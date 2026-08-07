import cn from 'classnames';
import Tooltip from './Tooltip';

export default function IconButton({ icon: Icon, label, className, ...props }) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        className={cn('icon-btn', className)}
        aria-label={label}
        {...props}
      >
        <Icon size={18} />
      </button>
    </Tooltip>
  );
}
