import * as RadixTabs from '@radix-ui/react-tabs';

export default function SegmentedControl({ value, onValueChange, options }) {
  return (
    <RadixTabs.Root value={value} onValueChange={onValueChange} className="segmented">
      <RadixTabs.List className="segmented__list" aria-label="视图切换">
        {options.map((option) => (
          <RadixTabs.Trigger
            key={option.value}
            value={option.value}
            className="segmented__item"
          >
            {option.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
    </RadixTabs.Root>
  );
}
