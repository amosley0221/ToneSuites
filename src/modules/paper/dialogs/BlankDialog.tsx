// New Paper document: a PDF app has nothing to show without a file — open one, or start a blank PDF.
import { Button, Dialog } from '@/ui';

export function BlankDialog({ onOpen, onBlank, onClose }: { onOpen: () => void; onBlank: () => void; onClose: () => void }) {
  return (
    <Dialog title="New Paper document" subtitle="PDF" width={560} height={250} onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <span style={{ flex: 1 }} />
        <Button onClick={onBlank}>Create blank PDF</Button>
        <Button variant="primary" onClick={onOpen}>Open PDF…</Button>
      </>}>
      <div style={{ flex: 1, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ font: 'var(--type-title)', letterSpacing: 'var(--ls-title)' }}>Open a PDF to get started</div>
        <div style={{ color: 'var(--mute)', font: 'var(--type-body)', lineHeight: 1.6 }}>
          Paper annotates, signs, fills, redacts and reorganizes existing PDFs. Open one from this device, or create a blank Letter page to build on.
        </div>
      </div>
    </Dialog>
  );
}
