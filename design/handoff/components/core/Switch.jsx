import React from 'react';
export function Switch({ on, onChange, label }) {
  return <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer', font: 'var(--type-small)' }}>{label}<span onClick={() => onChange && onChange(!on)} style={{ width: 34, height: 18, background: on ? 'var(--accent)' : 'var(--bg3)', position: 'relative', display: 'inline-block' }}><span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 14, height: 14, background: on ? 'var(--bg0)' : 'var(--mute)', transition: 'left var(--dur-fast) var(--ease)' }} /></span></label>;
}
