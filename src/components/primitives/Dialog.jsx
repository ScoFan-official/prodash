import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

export default function Dialog({ open, onOpenChange, title, description, children, footer }) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="dialog-overlay" />
        <RadixDialog.Content className="dialog-content">
          <div className="dialog-header">
            <RadixDialog.Title className="dialog-title">{title}</RadixDialog.Title>
            {description && (
              <RadixDialog.Description className="dialog-description">
                {description}
              </RadixDialog.Description>
            )}
            <RadixDialog.Close className="dialog-close" aria-label="关闭">
              <X size={18} />
            </RadixDialog.Close>
          </div>
          <div className="dialog-body">{children}</div>
          {footer && <div className="dialog-footer">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
