import * as React from 'react';
/** Tool-rail cell (36×30) showing the shortcut letter; a corner triangle marks tool groups with a flyout. */
export interface ToolButtonProps { shortcut: string; name: string; active?: boolean; hasGroup?: boolean; onClick?: () => void; style?: React.CSSProperties; }
export declare function ToolButton(props: ToolButtonProps): JSX.Element;
