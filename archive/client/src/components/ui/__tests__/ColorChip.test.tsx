import React from 'react';
import { render, screen } from '@testing-library/react';
import { ColorChip } from '../ColorChip';

describe('ColorChip', () => {
  it('renders with green color', () => {
    render(<ColorChip color="green" />);
    const chip = screen.getByRole('status');
    expect(chip).toHaveClass('bg-status-green');
  });

  it('renders with yellow color', () => {
    render(<ColorChip color="yellow" />);
    const chip = screen.getByRole('status');
    expect(chip).toHaveClass('bg-status-yellow');
  });

  it('renders with red color', () => {
    render(<ColorChip color="red" />);
    const chip = screen.getByRole('status');
    expect(chip).toHaveClass('bg-status-red');
  });

  it('renders with gray color', () => {
    render(<ColorChip color="gray" />);
    const chip = screen.getByRole('status');
    expect(chip).toHaveClass('bg-gray-400');
  });

  it('renders label when provided', () => {
    render(<ColorChip color="green" label="85" />);
    expect(screen.getByText('85')).toBeInTheDocument();
  });

  it('applies small size class', () => {
    render(<ColorChip color="green" size="sm" />);
    const chip = screen.getByRole('status');
    expect(chip).toHaveClass('w-3', 'h-3');
  });

  it('applies medium size class by default', () => {
    render(<ColorChip color="green" />);
    const chip = screen.getByRole('status');
    expect(chip).toHaveClass('w-4', 'h-4');
  });

  it('applies large size class', () => {
    render(<ColorChip color="green" size="lg" />);
    const chip = screen.getByRole('status');
    expect(chip).toHaveClass('w-6', 'h-6');
  });

  it('includes accessibility label', () => {
    render(<ColorChip color="green" />);
    const chip = screen.getByRole('status');
    expect(chip).toHaveAttribute('aria-label');
  });
});
