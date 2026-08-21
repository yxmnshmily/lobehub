/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import FormSliderWithInput from './FormSliderWithInput';

vi.mock('@lobehub/ui', () => ({
  SliderWithInput: ({
    onChange,
    value,
  }: {
    onChange?: (value: number) => void;
    value?: number;
  }) => (
    <input
      aria-label="slider-input"
      type="number"
      value={value}
      onChange={(event) => onChange?.(Number(event.target.value))}
    />
  ),
}));

describe('FormSliderWithInput', () => {
  it('commits the latest input value when the numeric input loses focus', async () => {
    const onChange = vi.fn();
    render(<FormSliderWithInput value={2} onChange={onChange} />);

    const input = screen.getByRole('spinbutton', { name: 'slider-input' });
    fireEvent.change(input, { target: { value: '3' } });

    await waitFor(() => expect(input).toHaveValue(3));
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith(3);
  });
});
