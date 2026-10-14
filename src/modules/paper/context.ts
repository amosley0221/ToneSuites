// React context shared by the Paper editor's components.
import { createContext, useContext } from 'react';
import type { ModuleApi } from '@/core/types';
import type { PaperModel } from './model';
import type { FieldInfo, Geom } from './render';

export interface PaperCtxValue {
  model: PaperModel;
  api: ModuleApi;
  /** Document change: undo entry + dirty. */
  commit: (fn: (m: PaperModel) => void, coalesce?: string) => void;
  fields: FieldInfo[];
  openSignature: () => void;
  /** Geometry used for pages whose size isn't known yet. */
  estimate: Geom;
}

export const PaperCtx = createContext<PaperCtxValue | null>(null);
export const usePaper = () => useContext(PaperCtx)!;

/** Page width in CSS px at 100% zoom (design: 680px). */
export const BASE_W = 680;
