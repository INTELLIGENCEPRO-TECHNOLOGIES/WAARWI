import { useEffect, useState } from 'react';
import { Loader2, Shield, Check, X, RotateCcw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import {
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  PERMISSION_CATEGORIES,
  type PermissionKey,
  type PermissionMap,
} from '../lib/permissions';

const ROLE_LABELS: Record<string, string> = {
  manager: 'Manager',
  cashier: 'Caissier',
  viewer: 'Consultation',
};

const ROLES = ['manager', 'cashier', 'viewer'] as const;

type RolePermissions = Record<string, PermissionMap>;

export function PermissionsTab() {
  const { profile } = useApp();
  const { success, error } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<RolePermissions>({});
  const [selectedRole, setSelectedRole] = useState<string>('manager');

  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin';

  const load = async () => {
    if (!profile?.tenant_id) return;
    setLoading(true);
    const { data: rows } = await supabase
      .from('role_permissions')
      .select('role, permissions')
      .eq('tenant_id', profile.tenant_id);

    const result: RolePermissions = {};
    for (const row of rows || []) {
      const map: PermissionMap = {} as PermissionMap;
      for (const k of PERMISSION_KEYS) {
        map[k] = row.permissions?.[k] === true;
      }
      result[row.role] = map;
    }
    setData(result);
    setLoading(false);
  };

  useEffect(() => { load(); }, [profile?.tenant_id]);

  const toggle = (role: string, key: PermissionKey) => {
    setData(prev => ({
      ...prev,
      [role]: {
        ...(prev[role] || {}),
        [key]: !(prev[role]?.[key]),
      },
    }));
  };

  const toggleAll = (role: string, value: boolean) => {
    const map: PermissionMap = {} as PermissionMap;
    for (const k of PERMISSION_KEYS) {
      map[k] = value;
    }
    setData(prev => ({ ...prev, [role]: map }));
  };

  const save = async () => {
    if (!profile?.tenant_id) return;
    setSaving(true);
    try {
      const role = selectedRole;
      const perms = data[role];
      if (!perms) { setSaving(false); return; }

      const { error: err } = await supabase
        .from('role_permissions')
        .update({ permissions: perms, updated_at: new Date().toISOString() })
        .eq('tenant_id', profile.tenant_id)
        .eq('role', role);

      if (err) throw err;
      success(`Permissions du rôle "${ROLE_LABELS[role]}" enregistrées`);
    } catch (e: any) {
      error(e.message || 'Erreur lors de la sauvegarde');
    }
    setSaving(false);
  };

  const resetDefaults = async () => {
    if (!profile?.tenant_id) return;
    setSaving(true);
    try {
      const { error: err } = await supabase.rpc('create_default_role_permissions', {
        p_tenant_id: profile.tenant_id,
      });
      if (err) throw err;
      await load();
      success('Permissions réinitialisées aux valeurs par défaut');
    } catch (e: any) {
      error(e.message || 'Erreur');
    }
    setSaving(false);
  };

  if (!isAdmin) {
    return (
      <div className="card p-8 text-center">
        <Shield className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <p className="text-sm text-slate-600 font-semibold">Accès réservé aux administrateurs</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="py-16 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-brand-700" />
      </div>
    );
  }

  const currentPerms = data[selectedRole];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">
            Définissez les autorisations de chaque rôle. Les administrateurs ont toujours un accès complet.
          </p>
        </div>
        <button
          onClick={resetDefaults}
          disabled={saving}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Réinitialiser par défaut
        </button>
      </div>

      {/* Role Tabs */}
      <div className="flex bg-slate-100/80 rounded-xl p-1 gap-1">
        {ROLES.map(role => (
          <button
            key={role}
            onClick={() => setSelectedRole(role)}
            className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all duration-200 ${
              selectedRole === role
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {ROLE_LABELS[role]}
          </button>
        ))}
      </div>

      {/* Quick actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => toggleAll(selectedRole, true)}
          className="text-xs font-medium text-brand-700 hover:text-brand-800 bg-brand-50 hover:bg-brand-100 px-3 py-1.5 rounded-lg transition-colors"
        >
          Tout autoriser
        </button>
        <button
          onClick={() => toggleAll(selectedRole, false)}
          className="text-xs font-medium text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg transition-colors"
        >
          Tout refuser
        </button>
      </div>

      {/* Permission Categories */}
      {currentPerms && (
        <div className="space-y-4">
          {PERMISSION_CATEGORIES.map(cat => (
            <div key={cat.label} className="bg-white border border-slate-200/70 rounded-2xl shadow-card overflow-hidden">
              <div className="px-4 py-3 bg-slate-50/80 border-b border-slate-100">
                <h3 className="text-sm font-bold text-slate-700">{cat.label}</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {cat.keys.map(key => (
                  <PermissionRow
                    key={key}
                    permKey={key}
                    enabled={currentPerms[key]}
                    onToggle={() => toggle(selectedRole, key)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Save Button */}
      <div className="sticky bottom-0 bg-gradient-to-t from-slate-50 via-slate-50 to-transparent pt-4 pb-2">
        <button
          onClick={save}
          disabled={saving}
          className="w-full sm:w-auto btn-icon-primary"
          title="Enregistrer les permissions"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

function PermissionRow({ permKey, enabled, onToggle }: { permKey: PermissionKey; enabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50/60 transition-colors text-left"
    >
      <span className="text-sm text-slate-700">{PERMISSION_LABELS[permKey]}</span>
      <div className={`w-9 h-5 rounded-full relative transition-colors duration-200 ${
        enabled ? 'bg-brand-600' : 'bg-slate-300'
      }`}>
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 flex items-center justify-center ${
          enabled ? 'translate-x-4' : 'translate-x-0.5'
        }`}>
          {enabled
            ? <Check className="w-2.5 h-2.5 text-brand-600" />
            : <X className="w-2.5 h-2.5 text-slate-400" />
          }
        </div>
      </div>
    </button>
  );
}
