import { AlertTriangle, Check } from 'lucide-react';
import { registerLabel, registerText, type PosRegisterOption } from '../lib/cashSession';

export function PosRegisterPicker({
  registers, selectedId, onSelect, otherSession, notice,
}: {
  registers: PosRegisterOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  otherSession?: { site_name: string; register_code: string; register_name?: string | null } | null;
  notice?: string;
}) {
  if (notice || otherSession) {
    return (
      <div className="flex items-start gap-2 max-w-sm px-3 py-2 rounded-md border border-neutral-300 bg-white text-left">
        <AlertTriangle className="w-4 h-4 text-neutral-700 shrink-0 mt-0.5" />
        <p className="text-xs leading-relaxed text-neutral-700 break-words">
          {notice || `Vous avez déjà une caisse ouverte (${registerText(otherSession!.register_code, otherSession!.register_name)}) au point de vente « ${otherSession!.site_name} ». Clôturez-la avant d’en ouvrir une autre.`}
        </p>
      </div>
    );
  }

  if (registers.length === 0) {
    return (
      <div className="flex items-start gap-2 max-w-sm px-3 py-2 rounded-md border border-neutral-300 bg-white text-left">
        <AlertTriangle className="w-4 h-4 text-neutral-700 shrink-0 mt-0.5" />
        <p className="text-xs leading-relaxed text-neutral-700">
          Aucune caisse ne vous est affectée sur ce point de vente. Contactez votre administrateur.
        </p>
      </div>
    );
  }

  if (registers.length === 1) {
    const r = registers[0];
    const l = registerLabel(r.code, r.name);
    return (
      <div className="max-w-sm text-[11px] leading-snug text-center break-words">
        <span className="text-neutral-400">Caisse : </span>
        <span className="font-semibold text-neutral-800">{l.primary}</span>
        {l.secondary && <span className="text-neutral-500 tabular-nums"> · {l.secondary}</span>}
        {r.status === 'busy' && <div className="text-neutral-500">En cours · {r.operator_name || 'Autre opérateur'}</div>}
        {r.locked && r.status !== 'busy' && <div className="text-neutral-500">Assignée à {r.assigned_to || 'un autre collaborateur'} · ouverture impossible</div>}
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm">
      <div className="text-[10px] uppercase tracking-wide text-neutral-400 mb-1.5 text-center">Choisissez votre caisse</div>
      <div role="radiogroup" className="flex flex-col divide-y divide-neutral-200 border border-neutral-200 rounded-md bg-white overflow-hidden">
        {registers.map(r => {
          const busy = r.status === 'busy' || !!r.locked;
          const active = selectedId === r.id;
          const l = registerLabel(r.code, r.name);
          const status = r.status === 'busy' ? `En cours · ${r.operator_name || 'Autre opérateur'}`
            : r.locked ? `Assignée à ${r.assigned_to || 'un autre collaborateur'}`
            : r.status === 'mine' ? 'Votre session' : null;
          return (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={busy}
              onClick={() => onSelect(r.id)}
              className={`flex items-start gap-2 px-3 py-2 text-left text-xs transition-colors ${
                busy ? 'cursor-not-allowed text-neutral-400 bg-neutral-50'
                  : active ? 'bg-neutral-900 text-white' : 'text-neutral-800 hover:bg-neutral-100'
              }`}
            >
              <span className="flex-1 min-w-0 break-words leading-snug">
                <span className="font-semibold">{l.primary}</span>
                {l.secondary && <span className={`ml-1.5 tabular-nums text-[10px] ${active ? 'text-neutral-300' : 'text-neutral-500'}`}>{l.secondary}</span>}
                {status && <span className={`block text-[10px] mt-0.5 ${active ? 'text-neutral-300' : busy ? 'text-neutral-400' : 'text-neutral-500'}`}>{status}</span>}
              </span>
              {active && !busy && <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
