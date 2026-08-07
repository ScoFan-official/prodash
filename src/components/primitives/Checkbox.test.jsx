import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Checkbox from './Checkbox';

describe('Checkbox', () => {
  it('renders as checkbox', () => {
    render(<Checkbox checked={false} onCheckedChange={() => {}} />);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('calls onCheckedChange when clicked', () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onCheckedChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalled();
  });
});
