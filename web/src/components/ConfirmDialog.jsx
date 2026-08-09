import Button from './ui/Button';
import Modal, { ModalFooter } from './Modal';

export default function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  pending = false,
  error,
  destructive = true,
}) {
  const close = () => {
    if (pending) return;
    onCancel();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={title}
      size="sm"
      showCloseButton={!pending}
    >
      <p className="text-sm text-muted-foreground">{description}</p>
      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}
      <ModalFooter className="flex-col-reverse sm:flex-row">
        <Button variant="outline" onClick={close} disabled={pending} className="w-full sm:w-auto">
          {cancelLabel}
        </Button>
        <Button
          variant={destructive ? 'destructive' : 'default'}
          onClick={onConfirm}
          loading={pending}
          disabled={pending}
          className="w-full sm:w-auto"
        >
          {confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
