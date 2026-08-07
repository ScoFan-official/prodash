import cn from 'classnames';

export default function Skeleton({ width, height, circle = false, className }) {
  return (
    <span
      className={cn('skeleton', { 'skeleton--circle': circle }, className)}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}
