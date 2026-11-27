type SubInfo = { planName: string; status: string; expiresAt: string | null; billingCycle: string };

const STATUS_STYLE: Record<string, { label: string; color: string }> = {
  trial_active: { label: 'Essai', color: 'text-blue-600' },
  active: { label: 'Actif', color: 'text-emerald-600' },
  expired: { label: 'Expiré', color: 'text-red-600' },
};

export default function SubscriptionStatus({ info, onClick, compact = false }: { info: SubInfo; onClick: () => void; compact?: boolean }) {
  const style = STATUS_STYLE[info.status] || { label: 'En attente', color: 'text-amber-600' };
  const date = info.expiresAt
    ? new Date(info.expiresAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
    : null;
  let detail = style.label;
  if (info.status === 'expired' && date) detail = `Expiré le ${date}`;
  else if (date && info.status !== 'pending_review') detail = `${style.label} jusqu'au ${date}`;
  else if (info.billingCycle === 'lifetime' && info.status === 'active') detail = 'Actif à vie';

  return (
    <button
      type="button"
      onClick={onClick}
      title={`Abonnement ${info.planName} │ ${detail}`}
      className="flex items-center gap-2 text-xs whitespace-nowrap hover:opacity-70 transition-opacity"
    >
      {!compact && <span className="text-[11px] text-neutral-500">Votre abonnement</span>}
      <span className={`truncate font-semibold text-neutral-800 ${compact ? 'max-w-20' : 'max-w-[120px]'}`}>{info.planName}</span>
      <span className={`font-bold ${style.color}`}>{compact && date && info.status !== 'pending_review' ? `${style.label} │ ${date}` : detail}</span>
    </button>
  );
}
