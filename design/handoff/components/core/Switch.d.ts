import * as React from 'react';
/** Square 34×18 toggle for module enable/disable and settings. */
export interface SwitchProps { on: boolean; onChange?: (v: boolean) => void; label?: string; style?: React.CSSProperties; }
export declare function Switch(props: SwitchProps): JSX.Element;
