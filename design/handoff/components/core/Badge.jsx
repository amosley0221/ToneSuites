import React from 'react';
export function Badge({ children, tone = 'neutral' }) {
  const color = { neutral: 'var(--mute)', accent: 'var(--accent)', positive: 'var(--positive)', negative: 'var(--negative)' }[tone];
  return <span style={{ font: 'var(--type-eyebrow)', letterSpacing: 'var(--ls-eyebrow)', color, textTransform: 'uppercase' }}>{children}</span>;
}
