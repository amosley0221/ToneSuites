import * as React from 'react';
/** 14px square checkbox — filled accent when on, 1px line when off; label is muted 12px. */
export interface CheckboxProps { checked: boolean; label: string; onChange?: (v: boolean) => void; style?: React.CSSProperties; }
export declare function Checkbox(props: CheckboxProps): JSX.Element;
