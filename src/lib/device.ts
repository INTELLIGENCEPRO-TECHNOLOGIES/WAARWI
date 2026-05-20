export const isTouchDevice = (() => {
  if (typeof window === 'undefined') return false;
  try {
    return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  } catch {
    return false;
  }
})();

export const desktopAutoFocus = !isTouchDevice;
