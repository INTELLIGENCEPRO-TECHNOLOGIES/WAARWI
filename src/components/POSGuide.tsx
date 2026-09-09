import { useEffect, useState } from 'react';
import {
  X, ChevronRight, Lightbulb, CheckCircle2,
  KeyRound, Search, ShoppingCart, Wallet, RotateCcw, ArrowDownRight,
  List, Lock, Receipt, User, Globe, HelpCircle, ArrowRight, Check,
} from 'lucide-react';

type StepDef = {
  icon: typeof Lightbulb;
  title: string;
  desc: string;
};

const OPEN_EVENT = 'waarwi:pos-guide:open';

function buildSteps(businessType: string): StepDef[] {
  const isAuto = businessType === 'auto_parts';

  const searchDesc = isAuto
    ? 'Recherchez par nom, référence interne, OEM ou code-barres. Filtrez par catégorie ou véhicule compatible. Cliquez sur un article pour l\'ajouter au panier.'
    : 'Recherchez par nom, référence interne ou code-barres. Filtrez par catégorie pour retrouver rapidement un produit. Cliquez sur un article pour l\'ajouter au panier.';

  return [
    { icon: KeyRound, title: 'Ouvrir la caisse', desc: 'Avant toute vente, démarrez une session en saisissant le fond de caisse. Cela sert de référence pour la clôture.' },
    { icon: Search, title: 'Trouver un produit', desc: searchDesc },
    { icon: ShoppingCart, title: 'Construire le panier', desc: 'Ajustez la quantité, modifiez le prix ou appliquez une remise par ligne. Bouton « Pause » pour mettre en attente et servir un autre client.' },
    { icon: User, title: 'Identifier le client', desc: 'Pour une vente à crédit ou un suivi fidélité, sélectionnez un client existant ou créez-en un nouveau depuis le panier.' },
    { icon: Wallet, title: 'Encaisser la vente', desc: 'Choisissez un ou plusieurs modes de paiement (espèces, mobile money, carte…). Le système calcule la monnaie à rendre.' },
    { icon: Receipt, title: 'Imprimer le ticket', desc: 'Le ticket s\'imprime automatiquement après validation. Vous pouvez le réimprimer depuis « Tickets ».' },
    { icon: Globe, title: 'Commandes web', desc: 'Si votre boutique en ligne est activée, transformez une commande web en vente caisse en un clic.' },
    { icon: RotateCcw, title: 'Effectuer un retour', desc: 'Remboursez un article d\'un ticket précédent. Le stock est remis à jour et la caisse débitée automatiquement.' },
    { icon: ArrowDownRight, title: 'Mouvement de caisse', desc: 'Sortie ou entrée exceptionnelle d\'argent : tracez chaque opération avec un motif. Tout apparaît dans le rapport de clôture.' },
    { icon: List, title: 'Consulter & rééditer', desc: '« Tickets » liste toutes les ventes. Cliquez pour voir le détail, réimprimer ou annuler. « Stats » donne un aperçu temps réel.' },
    { icon: Lock, title: 'Clôturer la session', desc: 'En fin de journée, saisissez le fond compté. L\'écart est calculé automatiquement et le rapport Z s\'imprime.' },
    { icon: CheckCircle2, title: 'Vous maîtrisez la caisse', desc: 'Vous connaissez le processus complet, de l\'ouverture à la clôture. Ce guide reste accessible à tout moment.' },
  ];
}

/* ───────────────────────────── Triggers ─────────────────────────────── */

function dispatchOpen(initialStep = 0) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { step: initialStep } }));
}

export function POSGuideCardTrigger({ label = 'Voir le guide complet de la caisse' }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => dispatchOpen(0)}
      className="mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-br from-amber-50 to-amber-100 border border-amber-200 text-amber-900 text-xs font-bold hover:from-amber-100 hover:to-amber-200 hover:shadow-sm active:scale-[0.99] transition-all"
    >
      <span className="relative flex items-center justify-center w-6 h-6 rounded-full bg-amber-500 text-white shadow-sm">
        <Lightbulb className="w-3.5 h-3.5" />
        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-white" />
      </span>
      <span className="tracking-wide">{label}</span>
      <ChevronRight className="w-3.5 h-3.5 opacity-60" />
    </button>
  );
}

export function POSGuideInlineTrigger() {
  return (
    <button
      type="button"
      onClick={() => dispatchOpen(0)}
      title="Guide caisse"
      aria-label="Ouvrir le guide caisse"
      className="shrink-0 group inline-flex items-center justify-center gap-1 h-8 px-2.5 rounded-md bg-transparent hover:bg-neutral-100 text-black text-[11px] font-semibold transition-all active:scale-95"
    >
      <span className="relative flex items-center justify-center w-4 h-4 text-black">
        <HelpCircle className="w-3.5 h-3.5" />
      </span>
      <span className="hidden sm:inline tracking-wide">Guide</span>
    </button>
  );
}

/* ───────────────────────────── Inline stepped guide ───────────────────── */

type Props = {
  tenantId: string | undefined;
  hasSession: boolean;
  businessType?: string;
  autoOpenOnFirstVisit?: boolean;
};

export function POSGuide({ tenantId, hasSession: _hasSession, businessType, autoOpenOnFirstVisit = true }: Props) {
  const STEPS = buildSteps(businessType || 'auto_parts');
  const storageKey = tenantId ? `waarwi:pos_guide_dismissed:${tenantId}` : '';

  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return storageKey ? localStorage.getItem(storageKey) === '1' : true; } catch { return true; }
  });
  const [step, setStep] = useState(0);

  // First visit: auto-show
  useEffect(() => {
    if (!autoOpenOnFirstVisit || !storageKey) return;
    try {
      const wasDismissed = localStorage.getItem(storageKey) === '1';
      if (!wasDismissed) setDismissed(false);
    } catch {}
  }, [autoOpenOnFirstVisit, storageKey]);

  // Listen for external open triggers
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      setStep(typeof detail.step === 'number' ? detail.step : 0);
      setDismissed(false);
    };
    window.addEventListener(OPEN_EVENT, handler);
    return () => window.removeEventListener(OPEN_EVENT, handler);
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try { if (storageKey) localStorage.setItem(storageKey, '1'); } catch {};
  };
  const reopen = () => {
    setDismissed(false);
    setStep(0);
    try { if (storageKey) localStorage.removeItem(storageKey); } catch {};
  };

  if (!tenantId) return null;

  const current = Math.min(Math.max(step, 0), STEPS.length - 1);
  const s = STEPS[current];
  const Icon = s.icon;

  if (dismissed) {
    return (
      <button onClick={reopen} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 hover:text-brand-700 transition-colors px-1 mt-1">
        <Lightbulb className="w-3.5 h-3.5" />Revoir le guide de la caisse
      </button>
    );
  }

  return (
    <div className="relative py-3 border-b border-neutral-100 animate-fade-in">
      <button onClick={dismiss} className="absolute top-3 right-0 p-1 text-neutral-400 hover:text-neutral-600 transition-colors"><X className="w-4 h-4" /></button>
      <div className="flex items-start gap-3">
        <Icon className="w-5 h-5 text-brand-700 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 pr-6">
          <h4 className="text-sm font-bold text-neutral-900">{s.title}</h4>
          <p className="text-xs text-neutral-500 mt-0.5">{s.desc}</p>
          <div className="flex items-center gap-2 mt-3">
            {STEPS.map((_, i) => <span key={i} className={`w-1.5 h-1.5 rounded-full transition-all ${i === current ? 'bg-brand-600 w-4' : 'bg-neutral-200'}`} />)}
            <div className="flex-1" />
            {current < STEPS.length - 1 ? (
              <button onClick={() => setStep(current + 1)} className="inline-flex items-center gap-1 text-[11px] font-bold text-brand-700 hover:text-brand-800 transition-colors">
                Suivant <ArrowRight className="w-3 h-3" />
              </button>
            ) : (
              <button onClick={dismiss} className="inline-flex items-center gap-1 text-[11px] font-bold text-brand-700 hover:text-brand-800 transition-colors">
                Compris <Check className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
