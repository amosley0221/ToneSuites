import * as React from 'react';
/** Native select styled as a Tone field (▾ trigger look); use for ≥4 options, Tabs/segmented for fewer. */
export interface SelectProps { value: string; options: string[]; onChange?: (v: string) => void; width?: number | string; mono?: boolean; style?: React.CSSProperties; }
export declare function Select(props: SelectProps): JSX.Element;
