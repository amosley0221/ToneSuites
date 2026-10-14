import { Button, Dialog } from '@/ui';

export function SaveBeforeClose({ title, onPick }: { title: string; onPick: (c: 'save' | 'discard' | 'cancel') => void }) {
  return (
    <Dialog title="Unsaved changes" subtitle={title} width={460} height="auto" onClose={() => onPick('cancel')}
      footer={<>
        <span style={{ flex: 1 }} />
        <Button onClick={() => onPick('cancel')}>Cancel</Button>
        <Button onClick={() => onPick('discard')}>Don't save</Button>
        <Button variant="primary" onClick={() => onPick('save')}>Save</Button>
      </>}>
      <div style={{ padding: 18, font: 'var(--type-body)' }}>Save changes to <b>{title}</b> before closing?</div>
    </Dialog>
  );
}
