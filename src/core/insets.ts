// Safe-area insets (status bar, display cutout, gesture bar) as CSS variables --inset-*.
// On Android the native activity provides them (window.ToneInsets); elsewhere CSS env() is used.
interface NativeInsets { get(): string; setLightBars(light: boolean): void }
const native = () => (window as unknown as { ToneInsets?: NativeInsets }).ToneInsets;

function apply() {
  const n = native();
  if (!n) return;
  try {
    const i = JSON.parse(n.get()) as Record<'top' | 'right' | 'bottom' | 'left', number>;
    const root = document.documentElement.style;
    for (const k of ['top', 'right', 'bottom', 'left'] as const) root.setProperty(`--inset-${k}`, `${i[k] ?? 0}px`);
  } catch { /* keep previous values */ }
}

export function startInsets() {
  apply();
  window.addEventListener('tone-insets', apply);
  window.addEventListener('resize', apply);
  // The bridge can attach a moment after first paint; pick it up when it does.
  for (const ms of [100, 500, 1500]) setTimeout(apply, ms);
}

/** Match status/navigation bar icon colour to the theme (Android). */
export function setSystemBarTheme(theme: 'dark' | 'light') {
  try { native()?.setLightBars(theme === 'light'); } catch { /* not on Android */ }
}
