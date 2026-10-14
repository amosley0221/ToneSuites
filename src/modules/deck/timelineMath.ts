// Animation timeline math (pure). Times in seconds.
import type { Animation, El } from './model';

export const MIN_RULER = 3;
export const MIN_DURATION = 0.1;
export const SNAP = 0.05;

export const snap = (t: number, step = SNAP) => Math.round(t / step) * step;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function animEnd(a: Animation): number { return a.delay + a.duration; }

/** Ruler length: at least 3 s, extended in 1 s steps to fit the longest animation. */
export function rulerSeconds(anims: Animation[]): number {
  const end = anims.reduce((m, a) => Math.max(m, animEnd(a)), 0);
  return Math.max(MIN_RULER, Math.ceil(end));
}

/** Ruler ticks at quarters of the ruler (0, 0.75, 1.5, 2.25 for a 3 s ruler). */
export function rulerTicks(seconds: number, count = 4): number[] {
  return Array.from({ length: count }, (_, i) => round2((seconds / count) * i));
}

export const secToPct = (t: number, ruler: number) => (t / ruler) * 100;
export const pxToSec = (px: number, widthPx: number, ruler: number) => (widthPx > 0 ? (px / widthPx) * ruler : 0);

export type DragMode = 'move' | 'start' | 'end';

/** Apply a horizontal drag (in seconds) to an animation bar. */
export function dragAnim(a: Animation, mode: DragMode, dt: number): Animation {
  if (mode === 'move') return { ...a, delay: round2(Math.max(0, snap(a.delay + dt))) };
  if (mode === 'end') return { ...a, duration: round2(Math.max(MIN_DURATION, snap(a.duration + dt))) };
  // dragging the left edge keeps the end fixed
  const end = animEnd(a);
  const delay = Math.min(end - MIN_DURATION, Math.max(0, snap(a.delay + dt)));
  return { ...a, delay: round2(delay), duration: round2(end - delay) };
}

/** Default for a newly animated element: starts after the slide's last animation ends. */
export function nextAnimation(existing: Animation[], effect: Animation['effect'] = 'fade'): Animation {
  const start = existing.reduce((m, a) => Math.max(m, animEnd(a)), 0);
  return { effect, delay: round2(start), duration: 0.5 };
}

/** Total play time of a slide's build. */
export function slideBuildTime(els: El[]): number {
  return els.reduce((m, e) => (e.anim ? Math.max(m, animEnd(e.anim)) : m), 0);
}

/** Visibility/progress of an animation at time t: 0 = not started, 1 = finished. */
export function progressAt(a: Animation, t: number): number {
  if (t <= a.delay) return 0;
  if (a.effect === 'appear' || a.duration <= 0) return 1;
  return Math.min(1, (t - a.delay) / a.duration);
}
