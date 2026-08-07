import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Banner from './Banner';

describe('Banner', () => {
  it('renders message', () => {
    render(<Banner>Network error</Banner>);
    expect(screen.getByRole('alert')).toHaveTextContent('Network error');
  });

  it('calls onClose when close clicked', () => {
    const onClose = vi.fn();
    render(<Banner onClose={onClose}>Error</Banner>);
    fireEvent.click(screen.getByLabelText('关闭'));
    expect(onClose).toHaveBeenCalled();
  });
});
