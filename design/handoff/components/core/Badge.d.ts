import * as React from 'react';
/** Mono uppercase status word (ONLINE, SYNCED, PENDING). No pill, no fill — just colored mono text. */
export interface BadgeProps { children: React.ReactNode; tone?: 'neutral' | 'accent' | 'positive' | 'negative'; style?: React.CSSProperties; }
export declare function Badge(props: BadgeProps): JSX.Element;
