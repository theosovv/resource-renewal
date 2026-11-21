import { useEffect, useId, useRef, type ReactNode } from 'react';

export function ModalDialog({
  title,
  description,
  children,
  onClose,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    const returnFocus = returnFocusRef.current;
    dialog.showModal();
    const initialFocus = dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]') ??
      dialog.querySelector<HTMLElement>('button, input, select, textarea, a[href]');
    initialFocus?.focus();
    return () => {
      if (dialog.open) {
        dialog.close();
      }
      returnFocus?.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="dialog__heading">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description && <p id={descriptionId}>{description}</p>}
        </div>
        <button className="icon-button" type="button" aria-label="Закрыть диалог" onClick={onClose}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
      {children}
    </dialog>
  );
}
