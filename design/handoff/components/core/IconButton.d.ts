import * as React from 'react';
/** Square glyph button for toolbars and the tool rail; active state is an accent fill. */
export interface IconButtonProps { label: string; glyph: React.ReactNode; active?: boolean; onClick?: () => void; size?: number; style?: React.CSSProperties; }
export declare function IconButton(props: IconButtonProps): JSX.Element;
