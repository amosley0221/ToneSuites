import * as React from 'react';
/** Title-bar document tab with a 2-letter module mark (Px, Cl, Dk, Wr, Pp or ⌂). */
export interface DocumentTabProps { mark: string; title: string; active?: boolean; onClick?: () => void; style?: React.CSSProperties; }
export declare function DocumentTab(props: DocumentTabProps): JSX.Element;
