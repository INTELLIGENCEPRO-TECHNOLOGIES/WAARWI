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
      success(`Permissions du role "${ROLE_LABELS[role]}" enregistrees`);
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
      success('Permissions reinitialisees aux valeurs par defaut');
    } catch (e: any) {
      error(e.message || 'Erreur');
    }
    setSaving(false);
  };

  if (!isAdmin) {
    return (
      <div className="py-12 text-center">
        <Shield className="w-6 h-6 text-neutral-300 mx-auto mb-2" />
        <p className="text-sm text-neutral-600 font-medium">Acces reserve aux administrateurs</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="py-16 flex justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-neutral-400" />
      </div>
    );
  }

  const currentPerms = data[selectedRole];

  return (
    <div className="space-y-6 max-w-none">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-sm text-neutral-500">
          Definissez les autorisations de chaque role. Les administrateurs ont toujours un acces complet.
        </p>
        <button
          onClick={resetDefaults}
          disabled={saving}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-500 hover:text-neutral-700 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reinitialiser
        </button>
      </div>

      {/* Role Tabs */}
      <div className="flex border-b border-neutral-200 gap-6">
        {ROLES.map(role => (
          <button
            key={role}
            onClick={() => setSelectedRole(role)}
            className={`pb-2.5 text-sm font-medium transition-all border-b-2 -mb-px ${
              selectedRole === role
                ? 'border-neutral-900 text-neutral-900'
                : 'border-transparent text-neutral-400 hover:text-neutral-600'
            }`}
          >
            {ROLE_LABELS[role]}
          </button>
        ))}
      </div>

      {/* Quick actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => toggleAll(selectedRole, true)}
          className="text-xs font-medium text-neutral-600 hover:text-neutral-900 transition-colors"
        >
          Tout autoriser
        </button>
        <span className="text-neutral-300">|</span>
        <button
          onClick={() => toggleAll(selectedRole, false)}
          className="text-xs font-medium text-neutral-600 hover:text-red-600 transition-colors"
        >
          Tout refuser
        </button>
      </div>

      {/* Permission Categories */}
      {currentPerms && (
        <div className="space-y-6">
          {PERMISSION_CATEGORIES.map(cat => (
            <div key={cat.label}>
              <h3 className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2">{cat.label}</h3>
              <div className="divide-y divide-neutral-100">
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
      <div className="flex justify-end pt-4 border-t border-neutral-100">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-neutral-900 text-white text-sm font-medium rounded-md hover:bg-neutral-800 transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Enregistrer
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
      className="w-full flex items-center justify-between py-2.5 px-1 hover:bg-neutral-50/60 transition-colors text-left"
    >
      <span className="text-sm text-neutral-700">{PERMISSION_LABELS[permKey]}</span>
      <div className={`w-9 h-5 rounded-full relative transition-colors duration-200 ${
        enabled ? 'bg-neutral-900' : 'bg-neutral-200'
      }`}>
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 flex items-center justify-center ${
          enabled ? 'translate-x-4' : 'translate-x-0.5'
        }`}>
          {enabled
            ? <Check className="w-2.5 h-2.5 text-neutral-900" />
            : <X className="w-2.5 h-2.5 text-neutral-400" />
          }
        </div>
      </div>
    </button>
  );
}
