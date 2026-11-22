import { useEffect, useRef, type ReactNode, type Ref } from 'react';
import { Check } from 'lucide-react';
import './Registration.css';

type RegistrationLayoutProps = {
  steps: readonly string[];
  activeStep: number;
  title: string;
  description?: string;
  headerAction: ReactNode;
  summary?: ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
  children: ReactNode;
};

export function RegistrationLayout({
  steps, activeStep, title, description, headerAction, summary, headingRef, children,
}: RegistrationLayoutProps) {
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = frame.current;
    const viewport = window.visualViewport;
    if (!element || !viewport) return;

    // On mobile the keyboard can resize the visible viewport without resizing the page.
    const resize = () => {
      if (viewport.scale === 1) element.style.setProperty('--registration-height', `${viewport.height}px`);
    };

    resize();
    viewport.addEventListener('resize', resize);
    return () => viewport.removeEventListener('resize', resize);
  }, []);

  return (
    <div className="registration" ref={frame}>
      <header className="registration-header">
        <a href="https://waarwi.com" aria-label="Waarwi, accueil" className="registration-brand">
          <img src="/newlogo.png" alt="Waarwi" width="155" height="29" />
        </a>
        {headerAction}
      </header>
      <div className="registration-layout">
        <aside className="registration-aside" aria-label="Progression de l’inscription">
          <p className="registration-aside-title">Inscription</p>
          <ol className="registration-progress" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
            {steps.map((label, index) => (
              <li key={label} className={index < activeStep ? 'is-complete' : ''} aria-current={index === activeStep ? 'step' : undefined}>
                <span className="registration-progress-number" aria-hidden="true">
                  {index < activeStep ? <Check size={16} /> : `0${index + 1}`}
                </span>
                {label}
              </li>
            ))}
          </ol>
          {summary}
        </aside>
        <main className="registration-main">
          <div className="registration-content">
            <header className="registration-heading">
              <h1 tabIndex={-1} ref={headingRef}>{title}</h1>
              {description && <p>{description}</p>}
            </header>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
