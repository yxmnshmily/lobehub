import { SliderWithInput, type SliderWithInputProps } from '@lobehub/ui/base-ui';
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';

interface FormSliderWithInputProps extends Omit<SliderWithInputProps, 'onChange' | 'value'> {
  ariaLabel?: string;
  onChange?: (value: number) => void;
  value?: number;
}

/**
 * Form-integrated slider with delayed onChange behavior.
 * Only triggers onChange on blur to prevent excessive updates during user interaction.
 */
const FormSliderWithInput = memo<FormSliderWithInputProps>(
  ({ ariaLabel, onChange, value: defaultValue, ...props }) => {
    const [value, setValue] = useState(defaultValue ?? 0);
    const valueRef = useRef(defaultValue ?? 0);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      const nextValue = defaultValue ?? 0;
      valueRef.current = nextValue;
      setValue(nextValue);
    }, [defaultValue]);

    useLayoutEffect(() => {
      if (!ariaLabel) return;
      const root = rootRef.current;
      root?.querySelector('input[type="range"]')?.setAttribute('aria-label', `${ariaLabel}滑块`);
      root?.querySelector('input[inputmode]')?.setAttribute('aria-label', `${ariaLabel}数值`);
    }, [ariaLabel]);

    return (
      <div
        ref={rootRef}
        style={{ width: '100%' }}
        onBlurCapture={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          onChange?.(valueRef.current);
        }}
      >
        <SliderWithInput
          onChange={(newValue) => {
            if (typeof newValue === 'number') {
              valueRef.current = newValue;
              setValue(newValue);
            }
          }}
          {...props}
          value={value}
        />
      </div>
    );
  },
);

FormSliderWithInput.displayName = 'FormSliderWithInput';

export default FormSliderWithInput;
