// A chart floating over the grid: select, move, resize, double-click to edit.
import { useRef } from 'react';
import { ChartSvg, chartDataFor } from './chart';
import type { ChartDef, Sheet, Workbook } from './model';

export function ChartObject({ wb, chart, sheet, onEdit }: { wb: Workbook; chart: ChartDef; sheet: Sheet; onEdit: () => void }) {
  const drag = useRef<{ mode: 'move' | 'resize'; x: number; y: number; orig: Pick<ChartDef, 'x' | 'y' | 'w' | 'h'> } | null>(null);
  const selected = wb.ui.selectedChart === chart.id;
  const data = chartDataFor(wb, chart);

  const down = (mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    wb.commitEdit();
    wb.ui.selectedChart = chart.id;
    wb.ui.focusGrid++;
    wb.emit();
    drag.current = { mode, x: e.clientX, y: e.clientY, orig: { x: chart.x, y: chart.y, w: chart.w, h: chart.h } };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const moveP = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const z = wb.ui.zoom;
    const dx = (e.clientX - d.x) / z;
    const dy = (e.clientY - d.y) / z;
    if (d.mode === 'move') { chart.x = Math.max(0, Math.round(d.orig.x + dx)); chart.y = Math.max(0, Math.round(d.orig.y + dy)); }
    else { chart.w = Math.max(160, Math.round(d.orig.w + dx)); chart.h = Math.max(120, Math.round(d.orig.h + dy)); }
    wb.emit();
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const next = { x: chart.x, y: chart.y, w: chart.w, h: chart.h };
    if (next.x === d.orig.x && next.y === d.orig.y && next.w === d.orig.w && next.h === d.orig.h) return;
    Object.assign(chart, d.orig);
    // Re-apply as an undoable change (the snapshot stores the original position).
    wb.structural(() => {
      const c = sheet.charts.find((x) => x.id === chart.id);
      if (c) Object.assign(c, next);
    });
  };

  const z = wb.ui.zoom;
  return (
    <div onPointerDown={down('move')} onPointerMove={moveP} onPointerUp={up} onPointerCancel={up} onDoubleClick={(e) => { e.stopPropagation(); onEdit(); }}
      style={{
        position: 'absolute', left: chart.x * z, top: chart.y * z, width: chart.w * z, height: chart.h * z, pointerEvents: 'auto',
        background: 'var(--bg1)', border: '1px solid var(--line)', outline: selected ? '2px solid var(--accent)' : 'none', outlineOffset: 0,
        cursor: 'move', boxShadow: 'var(--shadow-float)', touchAction: 'none',
      }}>
      <ChartSvg data={data} width={chart.w * z - 2} height={chart.h * z - 2}
        opts={{ type: chart.type, title: chart.title, showTitle: chart.showTitle, legend: chart.legend, gridlines: chart.gridlines, labels: chart.labels, hidden: chart.hidden }} />
      {selected && (
        <div onPointerDown={down('resize')} onPointerMove={moveP} onPointerUp={up} onPointerCancel={up}
          style={{ position: 'absolute', right: -5, bottom: -5, width: 10, height: 10, background: 'var(--accent)', cursor: 'nwse-resize', touchAction: 'none' }} />
      )}
    </div>
  );
}
