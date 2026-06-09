import { useEffect, useState } from 'react';
import {
  X, ChevronRight, ChevronLeft, Lightbulb, CheckCircle2,
  KeyRound, Search, ShoppingCart, Wallet, RotateCcw, ArrowDownRight,
  List, Lock, Receipt, User, Globe, HelpCircle,
} from 'lucide-react';

type StepDef = {
  icon: typeof Lightbulb;
  title: string;
  body: string;
  tip?: string;
};

const OPEN_EVENT = 'waarwi:pos-guide:open';

function buildSteps(businessType: string): StepDef[] {
  const isAuto = businessType === 'auto_parts';

  const searchBody = isAuto
    ? 'Recherchez par nom, référence interne, OEM ou code-barres. Filtrez par catégorie ou véhicule compatible. Cliquez sur un article (ou scannez son code-barres) pour l\'ajouter au panier.'
    : 'Recherchez par nom, référence interne ou code-barres. Filtrez par catégorie pour retrouver rapidement un produit. Cliquez sur un article (ou scannez son code-barres) pour l\'ajouter au panier.';

  return [
    {
      icon: KeyRound,
      title: '1. Ouvrir la caisse',
      body: 'Avant toute vente, démarrez une session en saisissant le fond de caisse (l\'argent physiquement présent dans le tiroir). Cela sert de référence pour la clôture.',
      tip: 'Sans session ouverte, vous ne pouvez ni encaisser ni mouvementer la caisse.',
    },
    {
      icon: Search,
      title: '2. Trouver un produit',
      body: searchBody,
      tip: 'Astuce : utilisez le scanner USB ou la caméra du téléphone pour gagner du temps.',
    },
    {
      icon: ShoppingCart,
      title: '3. Construire le panier',
      body: 'Ajustez la quantité avec +/− ou en saisissant la valeur. Vous pouvez modifier le prix, appliquer une remise par ligne ou supprimer une ligne. Sélectionnez un client si nécessaire (vente à crédit, fidélité…).',
      tip: 'Bouton « Pause » : mettez en attente un panier pour servir un autre client, puis reprenez-le plus tard.',
    },
    {
      icon: User,
      title: '4. Identifier le client (optionnel)',
      body: 'Pour une vente à crédit, un devis ou un suivi de fidélité, sélectionnez un client existant ou créez-en un nouveau directement depuis le panier.',
      tip: 'La vente à crédit n\'est possible qu\'avec un client identifié.',
    },
    {
      icon: Wallet,
      title: '5. Encaisser la vente',
      body: 'Cliquez sur « Payer ». Choisissez un ou plusieurs modes (espèces, mobile money, carte…) et saisissez les montants. Le système calcule automatiquement la monnaie à rendre.',
      tip: 'Les paiements multiples (split) sont supportés : par ex. moitié espèces, moitié Wave.',
    },
    {
      icon: Receipt,
      title: '6. Imprimer le ticket',
      body: 'Une fois la vente validée, le ticket s\'imprime automatiquement (ou s\'affiche pour impression A4). Vous pouvez aussi le réimprimer depuis « Tickets ».',
    },
    {
      icon: Globe,
      title: '7. Traiter une commande web',
      body: 'Si votre boutique en ligne est activée, le bouton « Commandes web » liste les commandes à transformer en vente caisse. Cliquez pour charger directement le panier.',
    },
    {
      icon: RotateCcw,
      title: '8. Effectuer un retour',
      body: 'Cliquez sur « Retour » pour rembourser un article d\'un ticket précédent. Le stock est automatiquement remis à jour et la caisse débitée.',
    },
    {
      icon: ArrowDownRight,
      title: '9. Mouvement de caisse',
      body: 'Sortie d\'argent (achat de fournitures, dépôt en banque…) ou entrée exceptionnelle : utilisez « Mouvement » pour tracer chaque opération avec un motif.',
      tip: 'Tous les mouvements apparaissent dans le rapport de clôture.',
    },
    {
      icon: List,
      title: '10. Consulter & rééditer',
      body: '« Tickets » liste toutes les ventes de la session. Cliquez sur un ticket pour voir le détail, réimprimer ou annuler. « Stats » donne un aperçu temps réel (CA, modes de paiement…).',
    },
    {
      icon: Lock,
      title: '11. Clôturer la session',
      body: 'En fin de journée, cliquez sur « Clôturer ». Saisissez le fond physique compté. L\'écart entre théorique et réel est calculé automatiquement et le rapport Z s\'imprime.',
      tip: 'Une fois clôturée, la session est verrouillée et archivée dans l\'historique.',
    },
    {
      icon: CheckCircle2,
      title: 'Vous maîtrisez la caisse',
      body: 'Vous connaissez maintenant le processus complet, de l\'ouverture à la clôture. Ce guide reste accessible à tout moment.',
    },
  ];
}

/* ───────────────────────────── Triggers ─────────────────────────────── */

function dispatchOpen(initialStep = 0) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { step: initialStep } }));
}

/** Bouton large à placer en bas d'une carte (ex : modale d'ouverture de caisse). */
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

/** Petit bouton compact à insérer à l'intérieur de la barre de recherche. */
export function POSGuideInlineTrigger() {
  return (
    <button
      type="button"
      onClick={() => dispatchOpen(0)}
      title="Guide caisse"
      aria-label="Ouvrir le guide caisse"
      className="shrink-0 group inline-flex items-center justify-center gap-1 h-7 pl-1.5 pr-2 rounded-full bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 text-[10px] font-bold transition-all active:scale-95"
    >
      <span className="relative flex items-center justify-center w-4 h-4 rounded-full bg-amber-500 text-white">
        <HelpCircle className="w-2.5 h-2.5" />
      </span>
      <span className="hidden sm:inline tracking-wide">Guide</span>
    </button>
  );
}

/* ───────────────────────────── Modal host ───────────────────────────── */

type Props = {
  tenantId: string | undefined;
  hasSession: boolean;
  businessType?: string;
  /** Si vrai, ouverture automatique à la première visite. Défaut : true. */
  autoOpenOnFirstVisit?: boolean;
};

export function POSGuide({ tenantId, hasSession, businessType, autoOpenOnFirstVisit = true }: Props) {
  const STEPS = buildSteps(businessType || 'auto_parts');
  const storageKey = tenantId ? `waarwi:pos_guide_dismissed:${tenantId}` : '';
  const seenKey = tenantId ? `waarwi:pos_guide_seen:${tenantId}` : '';

  const [open, setOpen] = useState<boolean>(false);
  const [step, setStep] = useState(0);

  // Première visite : ouverture auto
  useEffect(() => {
    if (!autoOpenOnFirstVisit || !storageKey) return;
    try {
      const dismissed = localStorage.getItem(storageKey) === '1';
      const seen = localStorage.getItem(seenKey) === '1';
      if (!dismissed && !seen) {
        setOpen(true);
        localStorage.setItem(seenKey, '1');
      }
    } catch {}
  }, [autoOpenOnFirstVisit, storageKey, seenKey]);

  // Écoute des déclencheurs externes
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      setStep(typeof detail.step === 'number' ? detail.step : 0);
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, handler);
    return () => window.removeEventListener(OPEN_EVENT, handler);
  }, []);

  const dismissForever = () => {
    try { if (storageKey) localStorage.setItem(storageKey, '1'); } catch {}
    setOpen(false);
  };
  const close = () => setOpen(false);

  const total = STEPS.length;
  const current = Math.min(Math.max(step, 0), total - 1);
  const S = STEPS[current];
  const Icon = S.icon;
  const isFirst = current === 0;
  const isLast = current === total - 1;

  if (!tenantId || !open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in"
      onClick={close}
    >
      <div
        className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-premium border border-slate-200 overflow-hidden animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative bg-gradient-to-br from-brand-700 via-brand-600 to-brand-800 text-white px-5 py-4">
          <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/10 pointer-events-none" />
          <div className="flex items-start gap-3 relative">
            <div className="w-11 h-11 rounded-2xl bg-white/15 backdrop-blur-sm border border-white/20 flex items-center justify-center shrink-0">
              <Icon className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-wider text-white/70 mb-0.5 inline-flex items-center gap-1.5">
                <Lightbulb className="w-3 h-3" />
                Guide caisse — Étape {current + 1} / {total}
              </div>
              <h3 className="text-base font-bold leading-tight">{S.title}</h3>
            </div>
            <button
              onClick={close}
              className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors shrink-0"
              aria-label="Fermer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Progress dots */}
          <div className="flex items-center gap-1 mt-3 relative flex-wrap">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                className={`h-1.5 rounded-full transition-all ${
                  i === current ? 'bg-white w-6' : i < current ? 'bg-white/70 w-3' : 'bg-white/30 w-3 hover:bg-white/50'
                }`}
                aria-label={`Étape ${i + 1}`}
              />
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          <p className="text-sm text-slate-700 leading-relaxed">{S.body}</p>
          {S.tip && (
            <div className="mt-3 flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200">
              <Lightbulb className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[12px] text-amber-900 leading-relaxed">{S.tip}</p>
            </div>
          )}

          {!hasSession && current === 0 && (
            <div className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-[11px] font-semibold text-emerald-800">
              <Lightbulb className="w-3 h-3" />
              Aucune session ouverte — commencez ici !
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-5 pb-4 pt-1 flex flex-wrap items-center gap-2 justify-between border-t border-slate-100">
          <button
            onClick={() => setStep(Math.max(0, current - 1))}
            disabled={isFirst}
            className="h-9 px-3 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1 transition-all"
          >
            <ChevronLeft className="w-4 h-4" /> Précédent
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={dismissForever}
              className="h-9 px-2.5 rounded-xl text-[11px] font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-all"
            >
              Ne plus afficher
            </button>
            {!isLast ? (
              <button
                onClick={() => setStep(Math.min(total - 1, current + 1))}
                className="h-9 px-3.5 rounded-xl bg-brand-700 text-white text-xs font-bold shadow-sm hover:bg-brand-800 active:scale-95 transition-all inline-flex items-center gap-1.5"
              >
                Suivant <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={close}
                className="h-9 px-3.5 rounded-xl bg-emerald-600 text-white text-xs font-bold shadow-sm hover:bg-emerald-700 active:scale-95 transition-all inline-flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" /> Terminer
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
