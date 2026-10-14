import * as React from 'react';
/** Modal shell: dim backdrop, zero-radius panel, header with accent square + title + mono subtitle + ✕. Body is a flex row — put a left list and a right form inside. */
export interface DialogProps { title: string; subtitle?: string; width?: number; height?: number; onClose?: () => void; children: React.ReactNode; style?: React.CSSProperties; }
export declare function Dialog(props: DialogProps): JSX.Element;
