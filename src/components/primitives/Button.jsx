import cn from 'classnames';

export default function Button({
  children,
  variant = 'default',
  size = 'md',
  isLoading = false,
  disabled = false,
  className,
  ...props
}) {
  return (
    <button
      className={cn(
        'btn',
        `btn--${variant}`,
        `btn--${size}`,
        { 'is-loading': isLoading },
        className
      )}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading && <span className="btn__spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
