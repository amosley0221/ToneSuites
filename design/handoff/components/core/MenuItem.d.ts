import * as React from 'react';
/** Row inside a dropdown menu (260px wide panel, shadow-float). divider draws a top rule. */
export interface MenuItemProps { label: string; shortcut?: string; hasSubmenu?: boolean; divider?: boolean; disabled?: boolean; onClick?: () => void; style?: React.CSSProperties; }
export declare function MenuItem(props: MenuItemProps): JSX.Element;
