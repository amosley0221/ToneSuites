import React from 'react';
export function Banner({ children, actions }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', background: 'var(--sel)', borderBottom: '1px solid var(--accent)', font: 'var(--type-small)', color: 'var(--ink)' }}><span style={{ width: 8, height: 8, background: 'var(--accent)', flexShrink: 0 }} /><div style={{ flex: 1 }}>{children}</div>{actions}</div>;
}
