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

/** Closing the app window with unsaved documents. */
export function QuitWithUnsaved({ titles, onPick }: { titles: string[]; onPick: (c: 'save' | 'discard' | 'cancel') => void }) {
  return (
    <Dialog title="Unsaved changes" subtitle={`${titles.length} document${titles.length === 1 ? '' : 's'}`} width={480} height="auto" onClose={() => onPick('cancel')}
      footer={<>
        <span style={{ flex: 1 }} />
        <Button onClick={() => onPick('cancel')}>Cancel</Button>
        <Button onClick={() => onPick('discard')}>Close without saving</Button>
        <Button variant="primary" onClick={() => onPick('save')}>Save all and close</Button>
      </>}>
      <div style={{ padding: 18, font: 'var(--type-body)' }}>
        These documents have changes that aren't saved:
        <ul style={{ margin: '10px 0 0', paddingLeft: 18 }}>{titles.map((t, i) => <li key={i}><b>{t}</b></li>)}</ul>
      </div>
    </Dialog>
  );
}

/** Saving to a format that can't hold everything in the document (e.g. a CSV with filters). */
export function FormatLoss({ title, format, losses, onPick }: {
  title: string; format: string; losses: string[]; onPick: (c: 'keep' | 'tone' | 'cancel') => void;
}) {
  const FMT = format.toUpperCase();
  return (
    <Dialog title={`Save as ${FMT}?`} subtitle={title} width={540} height="auto" onClose={() => onPick('cancel')}
      footer={<>
        <span style={{ flex: 1 }} />
        <Button onClick={() => onPick('cancel')}>Cancel</Button>
        <Button onClick={() => onPick('keep')}>Save {FMT} anyway</Button>
        <Button variant="primary" onClick={() => onPick('tone')}>Save as Tone document</Button>
      </>}>
      <div style={{ padding: 18, font: 'var(--type-body)' }}>
        A {FMT} file can't keep everything in this document. These would be lost:
        <ul style={{ margin: '10px 0', paddingLeft: 18 }}>{losses.map((l) => <li key={l}>{l}</li>)}</ul>
        <span style={{ color: 'var(--mute)' }}>A Tone document (.tone) keeps all of it and syncs between your devices. The {FMT} file stays as it is.</span>
      </div>
    </Dialog>
  );
}
