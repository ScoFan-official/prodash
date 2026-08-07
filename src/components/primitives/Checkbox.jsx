import * as RadixCheckbox from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';

export default function Checkbox({ id, checked, onCheckedChange, disabled, ...props }) {
  return (
    <RadixCheckbox.Root
      id={id}
      className="checkbox"
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      {...props}
    >
      <RadixCheckbox.Indicator className="checkbox__indicator">
        <Check size={14} strokeWidth={3} />
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );
}
