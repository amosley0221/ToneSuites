// Tool rail: 21 groups (shortcut letter, variants). `working: false` marks roadmap tools.

export type ToolId =
  | 'move' | 'artboard'
  | 'marqueeRect' | 'marqueeEllipse' | 'marqueeRow' | 'marqueeCol'
  | 'lasso' | 'polyLasso' | 'magLasso'
  | 'objectSelect' | 'quickSelect' | 'wand'
  | 'crop' | 'perspCrop' | 'slice' | 'sliceSelect'
  | 'frame'
  | 'eyedropper' | 'colorSampler' | 'ruler' | 'note' | 'count'
  | 'spotHeal' | 'remove' | 'heal' | 'patch' | 'caMove' | 'redEye'
  | 'brush' | 'pencil' | 'colorReplace' | 'mixer'
  | 'clone' | 'patternStamp'
  | 'historyBrush' | 'artHistory'
  | 'eraser' | 'bgEraser' | 'magicEraser'
  | 'gradient' | 'bucket'
  | 'blur' | 'sharpen' | 'smudge'
  | 'dodge' | 'burn' | 'sponge'
  | 'pen' | 'freePen' | 'curvPen' | 'addAnchor' | 'delAnchor' | 'convertPoint'
  | 'typeH' | 'typeV' | 'typeMaskH' | 'typeMaskV'
  | 'pathSelect' | 'directSelect'
  | 'rect' | 'ellipse' | 'triangle' | 'polygon' | 'line' | 'customShape'
  | 'hand' | 'rotateView'
  | 'zoom';

export interface ToolVariant { id: ToolId; name: string; working: boolean }
export interface ToolGroup { key: string; id: string; variants: ToolVariant[]; sep: boolean }

const v = (id: ToolId, name: string, working = true): ToolVariant => ({ id, name, working });

export const TOOL_GROUPS: ToolGroup[] = [
  { key: 'V', id: 'move', sep: false, variants: [v('move', 'Move'), v('artboard', 'Artboard', false)] },
  { key: 'M', id: 'marquee', sep: false, variants: [v('marqueeRect', 'Rectangular marquee'), v('marqueeEllipse', 'Elliptical marquee'), v('marqueeRow', 'Single row'), v('marqueeCol', 'Single column')] },
  { key: 'L', id: 'lasso', sep: false, variants: [v('lasso', 'Lasso'), v('polyLasso', 'Polygonal lasso'), v('magLasso', 'Magnetic lasso', false)] },
  { key: 'W', id: 'wand', sep: false, variants: [v('objectSelect', 'Object selection', false), v('quickSelect', 'Quick selection', false), v('wand', 'Magic wand')] },
  { key: 'C', id: 'crop', sep: true, variants: [v('crop', 'Crop'), v('perspCrop', 'Perspective crop', false), v('slice', 'Slice', false), v('sliceSelect', 'Slice select', false)] },
  { key: 'K', id: 'frame', sep: false, variants: [v('frame', 'Frame', false)] },
  { key: 'I', id: 'eyedropper', sep: false, variants: [v('eyedropper', 'Eyedropper'), v('colorSampler', 'Color sampler', false), v('ruler', 'Ruler', false), v('note', 'Note', false), v('count', 'Count', false)] },
  { key: 'J', id: 'heal', sep: true, variants: [v('spotHeal', 'Spot healing brush', false), v('remove', 'Remove', false), v('heal', 'Healing brush', false), v('patch', 'Patch', false), v('caMove', 'Content-aware move', false), v('redEye', 'Red eye', false)] },
  { key: 'B', id: 'brush', sep: false, variants: [v('brush', 'Brush'), v('pencil', 'Pencil'), v('colorReplace', 'Color replacement', false), v('mixer', 'Mixer brush', false)] },
  { key: 'S', id: 'stamp', sep: false, variants: [v('clone', 'Clone stamp'), v('patternStamp', 'Pattern stamp', false)] },
  { key: 'Y', id: 'history', sep: false, variants: [v('historyBrush', 'History brush'), v('artHistory', 'Art history brush', false)] },
  { key: 'E', id: 'eraser', sep: false, variants: [v('eraser', 'Eraser'), v('bgEraser', 'Background eraser', false), v('magicEraser', 'Magic eraser')] },
  { key: 'G', id: 'gradient', sep: false, variants: [v('gradient', 'Gradient'), v('bucket', 'Paint bucket')] },
  { key: 'R', id: 'blur', sep: false, variants: [v('blur', 'Blur'), v('sharpen', 'Sharpen'), v('smudge', 'Smudge')] },
  { key: 'O', id: 'dodge', sep: false, variants: [v('dodge', 'Dodge'), v('burn', 'Burn'), v('sponge', 'Sponge')] },
  { key: 'P', id: 'pen', sep: true, variants: [v('pen', 'Pen', false), v('freePen', 'Freeform pen', false), v('curvPen', 'Curvature pen', false), v('addAnchor', 'Add anchor', false), v('delAnchor', 'Delete anchor', false), v('convertPoint', 'Convert point', false)] },
  { key: 'T', id: 'type', sep: false, variants: [v('typeH', 'Horizontal type'), v('typeV', 'Vertical type', false), v('typeMaskH', 'Horizontal type mask', false), v('typeMaskV', 'Vertical type mask', false)] },
  { key: 'A', id: 'path', sep: false, variants: [v('pathSelect', 'Path selection', false), v('directSelect', 'Direct selection', false)] },
  { key: 'U', id: 'shape', sep: false, variants: [v('rect', 'Rectangle'), v('ellipse', 'Ellipse'), v('triangle', 'Triangle'), v('polygon', 'Polygon'), v('line', 'Line'), v('customShape', 'Custom shape', false)] },
  { key: 'H', id: 'hand', sep: true, variants: [v('hand', 'Hand'), v('rotateView', 'Rotate view', false)] },
  { key: 'Z', id: 'zoom', sep: false, variants: [v('zoom', 'Zoom')] },
];

export function groupOf(tool: ToolId): ToolGroup {
  return TOOL_GROUPS.find((g) => g.variants.some((x) => x.id === tool)) ?? TOOL_GROUPS[0];
}
export function variantOf(tool: ToolId): ToolVariant {
  return groupOf(tool).variants.find((x) => x.id === tool)!;
}
/** The first working variant of a group (default when switching to it). */
export function defaultVariant(g: ToolGroup): ToolId {
  return (g.variants.find((x) => x.working) ?? g.variants[0]).id;
}
