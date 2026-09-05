'use client';
import { useState, useRef, useEffect } from 'react';

// Drag-to-resize table columns — mirrors the pattern used by DriverReqTable in LegalRegulationView.
export function useResizableColumns(initial: number[]) {
  const [colWidths, setColWidths] = useState<number[]>(initial);
  const dragRef = useRef<{ col: number; startX: number; startW: number } | null>(null);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragRef.current) return;
      const { col, startX, startW } = dragRef.current;
      setColWidths(ws => ws.map((w, i) => i === col ? Math.max(40, startW + e.clientX - startX) : w));
    }
    function onUp() { dragRef.current = null; document.body.style.cursor = ''; }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, []);

  function startResize(e: React.MouseEvent, col: number) {
    e.preventDefault(); e.stopPropagation();
    dragRef.current = { col, startX: e.clientX, startW: colWidths[col] };
    document.body.style.cursor = 'col-resize';
  }

  return { colWidths, startResize };
}

export function ResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      onMouseDown={onMouseDown}
      onClick={e => e.stopPropagation()}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(167,139,250,0.5)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 4, cursor: 'col-resize', zIndex: 1, background: 'transparent', transition: 'background 0.1s' }}
    />
  );
}
