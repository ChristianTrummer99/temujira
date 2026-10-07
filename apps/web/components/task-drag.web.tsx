import * as React from 'react';
import type { DragHandleProps, DropZoneProps } from './task-drag';

export function TaskDragHandle({ children, disabled, onStart, onEnd, onMove }: DragHandleProps) {
  return <div draggable={!disabled} style={{ cursor: disabled ? 'default' : 'grab', flexShrink: 0 }}
    onDragStart={(e) => { if (disabled) { e.preventDefault(); return; } e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'temujira-task'); onStart(); }}
    onDragEnd={onEnd} onKeyDown={(e) => {
      if (!disabled && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault(); onMove(e.key === 'ArrowUp' ? -1 : 1);
      }
    }}>{children}</div>;
}

export function TaskDropZone({ children, enabled, onDrop }: DropZoneProps) {
  const [over, setOver] = React.useState(false);
  React.useEffect(() => { if (!enabled) setOver(false); }, [enabled]);
  return <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', minWidth: 0 }}
    onDragOver={(e) => { if (enabled) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(true); } }}
    onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
    onDrop={(e) => { if (enabled) { e.preventDefault(); e.stopPropagation(); setOver(false); onDrop(); } }}>
    {children}
    {enabled && over ? <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: '#f97316', pointerEvents: 'none' }} /> : null}
  </div>;
}
