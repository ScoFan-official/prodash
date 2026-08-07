import { X } from 'lucide-react';
import cn from 'classnames';

export default function Banner({ variant = 'error', children, onClose, action }) {
  return (
    <div className={cn('banner', `banner--${variant}`)} role="alert">
      <span className="banner__message">{children}</span>
      {action && <span className="banner__action">{action}</span>}
      {onClose && (
        <button className="banner__close" onClick={onClose} aria-label="关闭">
          <X size={16} />
        </button>
      )}
    </div>
  );
}
