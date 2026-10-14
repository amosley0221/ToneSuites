import * as React from 'react';
/** Panel tabs (underline, accent bar) or segmented control (ink fill) for 2–4 mutually exclusive options. */
export interface TabsProps { items: string[]; value: string; onChange?: (v: string) => void; style?: 'underline' | 'segmented'; style?: React.CSSProperties; }
export declare function Tabs(props: TabsProps): JSX.Element;
