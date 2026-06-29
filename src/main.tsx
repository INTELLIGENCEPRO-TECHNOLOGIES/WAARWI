import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { isTouchDevice } from './lib/device';

if (isTouchDevice) {
  let lastTapTime = 0;
  let lastTapTarget: EventTarget | null = null;

  document.addEventListener('touchstart', (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && !target.isContentEditable) return;

    const now = Date.now();
    const isDoubleTap = (now - lastTapTime < 350) && lastTapTarget === target;

    if (isDoubleTap) {
      target.removeAttribute('readonly');
      target.focus();
      lastTapTime = 0;
      lastTapTarget = null;
    } else {
      if (!target.hasAttribute('readonly')) {
        target.setAttribute('readonly', '');
        setTimeout(() => {
          target.removeAttribute('readonly');
        }, 400);
      }
      lastTapTime = now;
      lastTapTarget = target;
    }
  }, { passive: true });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
