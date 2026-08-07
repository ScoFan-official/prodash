import cn from 'classnames';

export default function Badge({ children, variant = 'default', color, className }) {
  return (
    <span
      className={cn('badge', `badge--${variant}`, className)}
      style={color ? { '--badge-color': color } : undefined}
    >
      {children}
    </span>
  );
}
