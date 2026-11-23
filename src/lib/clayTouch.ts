import type { PointerEvent } from 'react';

function setClayTouchPressed(event: PointerEvent<HTMLElement>, pressed: boolean) {
  if (event.pointerType !== 'touch' || !(event.target instanceof Element)) return;
  event.target.closest('button.clay-action')?.toggleAttribute('data-clay-pressed', pressed);
}

export const clayTouchHandlers = {
  onPointerDown: (event: PointerEvent<HTMLElement>) => setClayTouchPressed(event, true),
  onPointerUp: (event: PointerEvent<HTMLElement>) => setClayTouchPressed(event, false),
  onPointerCancel: (event: PointerEvent<HTMLElement>) => setClayTouchPressed(event, false),
};
