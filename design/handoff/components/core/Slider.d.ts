import * as React from 'react';
/** Adjustment slider: 4px track, accent fill, 14px square ink thumb, mono value at right. */
export interface SliderProps { label: string; value: number; min?: number; max?: number; display?: string; onChange?: (v: number) => void; style?: React.CSSProperties; }
export declare function Slider(props: SliderProps): JSX.Element;
