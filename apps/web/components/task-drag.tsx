import type { ReactNode } from 'react';

export interface DragHandleProps {
  children: ReactNode;
  disabled: boolean;
  onStart: () => void;
  onEnd: () => void;
  onMove: (direction: -1 | 1) => void;
}
export interface DropZoneProps {
  children: ReactNode;
  enabled: boolean;
  onDrop: () => void;
}
// Native/touch users use the move-up/move-down menu rendered inside the handle.
export function TaskDragHandle({ children }: DragHandleProps) { return <>{children}</>; }
export function TaskDropZone({ children }: DropZoneProps) { return <>{children}</>; }
