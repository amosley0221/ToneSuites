import * as React from 'react';
/** Rectangular, zero-radius action button; one primary per toolbar (Export / Share / Present / Save). */
export interface ButtonProps { variant?: 'primary' | 'strong' | 'default' | 'ghost'; size?: 'sm' | 'md'; disabled?: boolean; onClick?: () => void; children: React.ReactNode; style?: React.CSSProperties; }
export declare function Button(props: ButtonProps): JSX.Element;
