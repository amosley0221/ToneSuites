import * as React from 'react';
/** Single-line text field; focus is an accent border, no glow. */
export interface InputProps { value?: string; placeholder?: string; mono?: boolean; onChange?: (v: string) => void; width?: number | string; style?: React.CSSProperties; }
export declare function Input(props: InputProps): JSX.Element;
