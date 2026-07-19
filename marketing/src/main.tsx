import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { Landing } from './Landing';
import { LegalPage, resolveLegalPath } from './LegalPage';
import './index.css';

function App() {
  const [path, setPath] = useState(typeof window !== 'undefined' ? window.location.pathname : '/');
  const [route, setRoute] = useState<'landing' | 'legal'>(typeof window !== 'undefined' && resolveLegalPath(window.location.pathname) ? 'legal' : 'landing');

  useEffect(() => {
    const onPop = () => {
      setPath(window.location.pathname);
      setRoute(resolveLegalPath(window.location.pathname) ? 'legal' : 'landing');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const goLanding = () => {
    if (window.location.pathname !== '/') {
      window.history.pushState({}, '', '/');
    }
    setPath('/');
    setRoute('landing');
    window.scrollTo(0, 0);
  };

  if (route === 'legal') {
    const doc = resolveLegalPath(path);
    if (doc) return <LegalPage doc={doc} onBack={goLanding} />;
  }
  return <Landing />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
