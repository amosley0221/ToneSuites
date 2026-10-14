import React from 'react';
export function Eyebrow({ children, accent }) {
  return <div style={{ font: 'var(--type-eyebrow)', letterSpacing: 'var(--ls-eyebrow)', color: accent ? 'var(--accent)' : 'var(--mute)', textTransform: 'uppercase' }}>{children}</div>;
}
