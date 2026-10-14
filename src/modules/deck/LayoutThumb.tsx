// Schematic thumbnail of a layout's placeholders (inspector grid, masters dialog list).
import React from 'react';
import { SLIDE_H, SLIDE_W, type Layout } from './model';

export function LayoutThumb({ layout, active, onClick, title }: { layout: Layout; active?: boolean; onClick?: () => void; title?: string }) {
  return (
    <div onClick={onClick} title={title ?? layout.name} className={active ? '' : 'hov-border'}
      style={{ aspectRatio: '16 / 9', border: `${active ? 2 : 1}px solid ${active ? 'var(--accent)' : 'var(--line)'}`, background: 'var(--bg0)', position: 'relative', cursor: onClick ? 'pointer' : 'default', overflow: 'hidden', transition: 'border-color var(--dur-fast)' }}>
      {layout.placeholders.map((p, i) => {
        const st: React.CSSProperties = {
          position: 'absolute', left: `${(p.rect.x / SLIDE_W) * 100}%`, top: `${(p.rect.y / SLIDE_H) * 100}%`, width: `${(p.rect.w / SLIDE_W) * 100}%`,
        };
        if (p.role === 'title') return <div key={i} style={{ ...st, height: '9%', minHeight: 3, width: `${Math.min(60, (p.rect.w / SLIDE_W) * 100)}%`, background: 'var(--mute)' }} />;
        if (p.role === 'kicker') return <div key={i} style={{ ...st, height: '3%', minHeight: 1, width: '22%', background: 'var(--mute)', opacity: 0.6 }} />;
        if (p.role === 'image') return <div key={i} style={{ ...st, height: `${(p.rect.h / SLIDE_H) * 100}%`, background: 'var(--bg3)' }} />;
        return <div key={i} style={{ ...st, height: `${(p.rect.h / SLIDE_H) * 100}%`, background: 'var(--bg3)' }} />;
      })}
    </div>
  );
}
