import { useState } from 'react';
import { Button, Dialog, FormRow, Input } from '@/ui';
import type { PaperModel } from '../model';

export function GoToDialog({ model, onGo, onClose }: { model: PaperModel; onGo: (i: number) => void; onClose: () => void }) {
  const [v, setV] = useState(String(model.ui.page + 1));
  const n = parseInt(v, 10);
  const ok = n >= 1 && n <= model.pages.length;
  return (
    <Dialog title="Go to page" subtitle={`1–${model.pages.length}`} width={380} height={190} onClose={onClose}
      footer={<><span style={{ flex: 1 }} /><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!ok} onClick={() => onGo(n - 1)}>Go</Button></>}>
      <div style={{ flex: 1, padding: '16px 20px' }}>
        <FormRow label="Page number">
          <Input value={v} onChange={setV} mono autoFocus style={{ width: 90 }} onKeyDown={(e) => { if (e.key === 'Enter' && ok) { e.preventDefault(); onGo(n - 1); } }} />
        </FormRow>
      </div>
    </Dialog>
  );
}
