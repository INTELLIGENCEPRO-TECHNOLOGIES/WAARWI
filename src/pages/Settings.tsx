import { useEffect, useRef, useState } from 'react';
import { Loader2, Save, Building2, Store, CreditCard, Tag, BookOpen, Plus, CreditCard as Edit2, Trash2, Car, Upload, X, ImageOff, ShoppingBag, ExternalLink, Copy, Check, Globe, ToggleLeft, ToggleRight, AlertCircle, Users, Shield, KeyRound, Image as ImageIcon, Database } from 'lucide-react';
import { BackupTab } from '../components/BackupTab';
import { PermissionsTab } from '../components/PermissionsTab';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { Modal, ConfirmDialog } from '../components/Modal';
import { getBrandLogo } from '../lib/brandLogos';
import { desktopAutoFocus } from '../lib/device';

type TabKey = 'company' | 'boutique' | 'users' | 'permissions' | 'sites' | 'payments' | 'categories' | 'brands' | 'accounting' | 'backup';

export function Settings() {
  const { refresh, profile, tenant } = useApp();
  const autoMode = (tenant?.business_type || 'auto_parts') === 'auto_parts';
  const [tab, setTab] = useState<TabKey>('company');

  const tabs: { k: TabKey; l: string; icon: any }[] = [
    { k: 'company', l: 'Entreprise', icon: Building2 },
    { k: 'boutique', l: 'Boutique en ligne', icon: ShoppingBag },
    { k: 'users', l: 'Utilisateurs', icon: Users },
    { k: 'permissions', l: 'Permissions', icon: Shield },
    { k: 'sites', l: 'Magasins', icon: Store },
    { k: 'payments', l: 'Paiements', icon: CreditCard },
    { k: 'categories', l: 'Catégories', icon: Tag },
    ...(autoMode ? [{ k: 'brands' as TabKey, l: 'Marques véhicules', icon: Car }] : []),
    { k: 'accounting', l: 'Comptabilité', icon: BookOpen },
    { k: 'backup', l: 'Sauvegarde', icon: Database },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Paramètres</h1>
        <p className="text-sm text-slate-500 mt-1">Configuration de votre entreprise et des référentiels.</p>
      </div>

      <div className="flex overflow-x-auto border-b border-slate-200">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.k} onClick={() => setTab(t.k)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap transition-colors ${tab === t.k ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              <Icon className="w-4 h-4" />{t.l}
            </button>
          );
        })}
      </div>

      {tab === 'company' && <CompanyTab onRefresh={refresh} />}
      {tab === 'boutique' && <BoutiqueTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'permissions' && <PermissionsTab />}
      {tab === 'sites' && <SitesTab />}
      {tab === 'payments' && <PaymentsTab />}
      {tab === 'categories' && <CategoriesTab />}
      {tab === 'brands' && autoMode && <BrandsTab />}
      {tab === 'accounting' && <AccountingTab />}
      {tab === 'backup' && <BackupTab />}
    </div>
  );
}

/* ===================== COMPANY ===================== */
function CompanyTab({ onRefresh }: { onRefresh: () => void }) {
  const { tenant } = useApp();
  const { success, error } = useToast();
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (tenant) setForm({ ...tenant }); }, [tenant]);

  const uploadLogo = async (file: File) => {
    if (!tenant) return;
    if (file.size > 2 * 1024 * 1024) { error('Logo max 2 Mo'); return; }
    setUploading(true);
    const ext = file.name.split('.').pop() || 'png';
    const path = `${tenant.id}/logo-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('tenant-logos').upload(path, file, { upsert: true, cacheControl: '3600' });
    if (upErr) { error(upErr.message); setUploading(false); return; }
    const { data: urlData } = supabase.storage.from('tenant-logos').getPublicUrl(path);
    const publicUrl = urlData.publicUrl;
    const { error: e } = await supabase.from('tenants').update({ logo_url: publicUrl }).eq('id', tenant.id);
    setUploading(false);
    if (e) error(e.message);
    else { setForm((f: any) => ({ ...f, logo_url: publicUrl })); success('Logo mis à jour'); onRefresh(); }
  };

  const removeLogo = async () => {
    if (!tenant) return;
    const { error: e } = await supabase.from('tenants').update({ logo_url: '' }).eq('id', tenant.id);
    if (e) error(e.message);
    else { setForm((f: any) => ({ ...f, logo_url: '' })); success('Logo retiré'); onRefresh(); }
  };

  const save = async () => {
    if (!tenant) return;
    setSaving(true);
    const { error: e } = await supabase.from('tenants').update({
      name: form.name, legal_name: form.legal_name || '', ninea: form.ninea || '',
      rccm: form.rccm || '', address: form.address || '', phone: form.phone || '', email: form.email || '',
      website: form.website || '', slogan: form.slogan || '',
    }).eq('id', tenant.id);
    setSaving(false);
    if (e) error(e.message); else { success('Paramètres enregistrés'); onRefresh(); }
  };

  return (
    <div className="card p-5 sm:p-6 max-w-2xl">
      {/* Logo upload */}
      <div className="mb-5 pb-5 border-b border-slate-100">
        <label className="label mb-2">Logo de l'entreprise</label>
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
            {form.logo_url ? (
              <img src={form.logo_url} alt="Logo" className="w-full h-full object-contain" />
            ) : (
              <ImageIcon className="w-7 h-7 text-slate-300" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-500 mb-2">
              Le logo s'affiche dans l'en-tête, la boutique, les tickets et factures. PNG, JPG, WebP ou SVG. Max 2 Mo.
            </p>
            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f); e.target.value = ''; }}
              />
              <button onClick={() => fileRef.current?.click()} disabled={uploading} className="btn-secondary text-xs">
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                {form.logo_url ? 'Remplacer' : 'Téléverser'}
              </button>
              {form.logo_url && (
                <button onClick={removeLogo} className="text-xs text-red-600 hover:bg-red-50 px-2 py-1.5 rounded-lg flex items-center gap-1">
                  <Trash2 className="w-3.5 h-3.5" />Retirer
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2"><label className="label">Nom commercial *</label><input value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} className="input" /></div>
        <div><label className="label">Raison sociale</label><input value={form.legal_name || ''} onChange={e => setForm({ ...form, legal_name: e.target.value })} className="input" /></div>
        <div><label className="label">NINEA</label><input value={form.ninea || ''} onChange={e => setForm({ ...form, ninea: e.target.value })} className="input" /></div>
        <div><label className="label">RCCM</label><input value={form.rccm || ''} onChange={e => setForm({ ...form, rccm: e.target.value })} className="input" /></div>
        <div><label className="label">Téléphone</label><input value={form.phone || ''} onChange={e => setForm({ ...form, phone: e.target.value })} className="input" /></div>
        <div className="sm:col-span-2"><label className="label">Email</label><input value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} className="input" /></div>
        <div className="sm:col-span-2"><label className="label">Site web</label><input value={form.website || ''} onChange={e => setForm({ ...form, website: e.target.value })} className="input" placeholder="https://…" /></div>
        <div className="sm:col-span-2"><label className="label">Adresse</label><textarea value={form.address || ''} onChange={e => setForm({ ...form, address: e.target.value })} className="input resize-none" rows={2} /></div>
        <div className="sm:col-span-2"><label className="label">Slogan</label><input value={form.slogan || ''} onChange={e => setForm({ ...form, slogan: e.target.value })} className="input" placeholder="Ex: Pièces auto de qualité, livrées rapidement." /></div>
      </div>

      {/* Reports preferences */}
      <div className="mt-5 border-t border-slate-200 pt-5">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Préférences des états & rapports</div>
        <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
          <div>
            <div className="text-sm font-semibold text-slate-700">Afficher les marges dans les rapports</div>
            <div className="text-xs text-slate-400 mt-0.5">Inclut la marge brute et le taux de marge dans les états de ventes</div>
          </div>
          <button
            type="button"
            onClick={async () => {
              if (!tenant) return;
              const cur = (tenant as any)?.settings || {};
              const newVal = !cur.show_margin_in_reports;
              await supabase.from('tenants').update({ settings: { ...cur, show_margin_in_reports: newVal } }).eq('id', tenant.id);
              onRefresh();
            }}
            className="shrink-0 ml-4"
          >
            {(tenant as any)?.settings?.show_margin_in_reports
              ? <ToggleRight className="w-8 h-8 text-brand-600" />
              : <ToggleLeft className="w-8 h-8 text-slate-400" />}
          </button>
        </div>
      </div>

      <div className="mt-5 flex justify-end">
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Enregistrer
        </button>
      </div>
    </div>
  );
}

/* ===================== BOUTIQUE ===================== */
function BoutiqueTab() {
  const { tenant, refresh } = useApp();
  const { success, error } = useToast();
  const [settings, setSettings] = useState<any>(null);
  const [slug, setSlug] = useState('');
  const [editingSlug, setEditingSlug] = useState(false);
  const [slugInput, setSlugInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  const shopUrl = `${window.location.origin}/shop/${slug}`;

  const load = async () => {
    if (!tenant) return;
    setLoading(true);
    let [{ data: s }, { data: t }] = await Promise.all([
      supabase.from('shop_settings').select('*').eq('tenant_id', tenant.id).maybeSingle(),
      supabase.from('tenants').select('public_slug').eq('id', tenant.id).maybeSingle(),
    ]);
    if (!s) {
      const { data: created } = await supabase
        .from('shop_settings')
        .insert({ tenant_id: tenant.id, shop_name: tenant.name || '' })
        .select()
        .maybeSingle();
      s = created;
    }
    setSettings(s || null);
    setSlug(t?.public_slug || '');
    setLoading(false);
  };

  useEffect(() => { load(); }, [tenant?.id]);

  const saveSettings = async () => {
    if (!tenant || !settings) return;
    setSaving(true);
    const { error: e } = await supabase.from('shop_settings').update({
      is_active: settings.is_active,
      shop_name: settings.shop_name,
      tagline: settings.tagline,
      phone: settings.phone,
      whatsapp: settings.whatsapp,
      address: settings.address,
      welcome_msg: settings.welcome_msg,
      footer_text: settings.footer_text,
    }).eq('tenant_id', tenant.id);
    setSaving(false);
    if (e) error(e.message); else success('Paramètres boutique enregistrés');
  };

  const saveSlug = async () => {
    if (!tenant) return;
    const cleaned = slugInput.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!cleaned) { error('Le slug ne peut pas être vide'); return; }
    setSaving(true);
    const { error: e } = await supabase.from('tenants').update({ public_slug: cleaned }).eq('id', tenant.id);
    setSaving(false);
    if (e) {
      error(e.message.includes('unique') ? 'Ce slug est déjà pris, choisissez-en un autre.' : e.message);
    } else {
      setSlug(cleaned);
      setEditingSlug(false);
      success('Slug mis à jour');
      refresh();
    }
  };

  const toggleActive = async () => {
    if (!tenant || !settings) return;
    if (!slug) { error('Vous devez d\'abord définir un slug public pour activer la boutique.'); return; }
    const next = !settings.is_active;
    setSaving(true);
    const { error: e } = await supabase.from('shop_settings').update({ is_active: next }).eq('tenant_id', tenant.id);
    setSaving(false);
    if (e) error(e.message);
    else {
      setSettings({ ...settings, is_active: next });
      success(next ? 'Boutique activée — elle est maintenant accessible au public.' : 'Boutique désactivée.');
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(shopUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const openShop = () => window.open(shopUrl, '_blank');

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-5 h-5 animate-spin text-brand-700" /></div>;

  if (!settings) return (
    <div className="card p-8 text-center text-slate-500">
      <AlertCircle className="w-8 h-8 mx-auto mb-3 text-amber-400" />
      <p className="font-medium">Paramètres boutique introuvables.</p>
      <p className="text-sm mt-1">Rechargez la page ou contactez le support.</p>
    </div>
  );

  return (
    <div className="space-y-6 max-w-2xl">

      {/* Status banner */}
      <div className={`rounded-2xl p-5 border ${settings.is_active ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${settings.is_active ? 'bg-emerald-100' : 'bg-amber-100'}`}>
              <Globe className={`w-5 h-5 ${settings.is_active ? 'text-emerald-700' : 'text-amber-700'}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-bold ${settings.is_active ? 'text-emerald-800' : 'text-amber-800'}`}>
                  Boutique {settings.is_active ? 'ACTIVE' : 'INACTIVE'}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${settings.is_active ? 'bg-emerald-200 text-emerald-800' : 'bg-amber-200 text-amber-800'}`}>
                  {settings.is_active ? 'En ligne' : 'Hors ligne'}
                </span>
              </div>
              <p className={`text-xs mt-1 ${settings.is_active ? 'text-emerald-700' : 'text-amber-700'}`}>
                {settings.is_active
                  ? 'Votre boutique est visible par tous vos clients.'
                  : 'Activez la boutique pour la rendre visible au public.'}
              </p>
            </div>
          </div>
          <button
            onClick={toggleActive}
            disabled={saving}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              settings.is_active
                ? 'bg-red-100 text-red-700 hover:bg-red-200'
                : 'bg-emerald-600 text-white hover:bg-emerald-700'
            }`}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : settings.is_active ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
            {settings.is_active ? 'Désactiver' : 'Activer la boutique'}
          </button>
        </div>
      </div>

      {/* URL publique */}
      <div className="card p-5 space-y-4">
        <h3 className="font-semibold text-slate-900 flex items-center gap-2"><Globe className="w-4 h-4 text-brand-700" />Adresse publique de la boutique</h3>

        {/* Slug editor */}
        <div>
          <label className="label">Slug URL (identifiant unique)</label>
          {editingSlug ? (
            <div className="flex gap-2">
              <div className="flex-1 flex items-center border border-slate-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-brand-500 focus-within:border-brand-500">
                <span className="px-3 py-2.5 text-sm text-slate-400 bg-slate-50 border-r border-slate-200 whitespace-nowrap">/shop/</span>
                <input
                  value={slugInput}
                  onChange={e => setSlugInput(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                  className="flex-1 px-3 py-2.5 text-sm outline-none font-mono"
                  placeholder="mon-entreprise"
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') saveSlug(); if (e.key === 'Escape') setEditingSlug(false); }}
                />
              </div>
              <button onClick={saveSlug} disabled={saving} className="btn-primary py-2.5 px-4">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              </button>
              <button onClick={() => setEditingSlug(false)} className="btn-secondary py-2.5 px-4"><X className="w-4 h-4" /></button>
            </div>
          ) : (
            <div className="flex gap-2 items-center">
              <div className="flex-1 flex items-center border border-slate-200 rounded-lg bg-slate-50 overflow-hidden">
                <span className="px-3 py-2.5 text-sm text-slate-400 border-r border-slate-200 whitespace-nowrap">/shop/</span>
                <span className="flex-1 px-3 py-2.5 text-sm font-mono text-slate-800">{slug || '—'}</span>
              </div>
              <button
                onClick={() => { setSlugInput(slug); setEditingSlug(true); }}
                className="btn-secondary py-2.5 px-4 text-sm"
              >
                <Edit2 className="w-4 h-4" />Modifier
              </button>
            </div>
          )}
          <p className="text-xs text-slate-400 mt-1.5">Minuscules, chiffres et tirets uniquement. Ex: <code className="bg-slate-100 px-1 rounded">sad-pieces-auto</code></p>
        </div>

        {/* Full URL + actions */}
        {slug && (
          <div className="bg-slate-50 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 font-medium uppercase tracking-wide">URL complète</span>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm text-brand-800 font-mono break-all bg-white border border-slate-200 rounded-lg px-3 py-2.5">{shopUrl}</code>
            </div>
            <div className="flex gap-2">
              <button onClick={copyLink} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-semibold transition-colors">
                {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copié !' : 'Copier le lien'}
              </button>
              <button
                onClick={openShop}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                  settings.is_active
                    ? 'bg-brand-700 hover:bg-brand-800 text-white'
                    : 'bg-slate-200 hover:bg-slate-300 text-slate-600'
                }`}
              >
                <ExternalLink className="w-4 h-4" />
                Voir la boutique
              </button>
            </div>
            {!settings.is_active && (
              <p className="text-xs text-amber-700 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                La boutique est inactive — activez-la ci-dessus pour que vos clients puissent y accéder.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Shop settings form */}
      <div className="card p-5 space-y-4">
        <h3 className="font-semibold text-slate-900 flex items-center gap-2"><ShoppingBag className="w-4 h-4 text-brand-700" />Informations de la boutique</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="label">Nom affiché dans la boutique</label>
            <input value={settings.shop_name || ''} onChange={e => setSettings({ ...settings, shop_name: e.target.value })} className="input" />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Accroche (tagline)</label>
            <input value={settings.tagline || ''} onChange={e => setSettings({ ...settings, tagline: e.target.value })} className="input" placeholder="Ex: Pièces auto de qualité, livrées rapidement." />
          </div>
          <div>
            <label className="label">Téléphone boutique</label>
            <input value={settings.phone || ''} onChange={e => setSettings({ ...settings, phone: e.target.value })} className="input" placeholder="+221 77 000 00 00" />
          </div>
          <div>
            <label className="label">Numéro WhatsApp</label>
            <input value={settings.whatsapp || ''} onChange={e => setSettings({ ...settings, whatsapp: e.target.value })} className="input" placeholder="+221 77 000 00 00" />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Adresse</label>
            <input value={settings.address || ''} onChange={e => setSettings({ ...settings, address: e.target.value })} className="input" />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Message d'accueil</label>
            <textarea value={settings.welcome_msg || ''} onChange={e => setSettings({ ...settings, welcome_msg: e.target.value })} className="input resize-none" rows={2} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Texte de pied de page</label>
            <input value={settings.footer_text || ''} onChange={e => setSettings({ ...settings, footer_text: e.target.value })} className="input" />
          </div>
        </div>
        <div className="flex justify-end pt-2">
          <button onClick={saveSettings} disabled={saving} className="btn-primary">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Enregistrer
          </button>
        </div>
      </div>

    </div>
  );
}

/* ===================== SITES ===================== */
function SitesTab() {
  const { tenant, refresh } = useApp();
  const { success, error } = useToast();
  const [list, setList] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!tenant) return;
    const { data } = await supabase.from('sites').select('*').eq('tenant_id', tenant.id).order('name');
    setList(data || []);
  };
  useEffect(() => { load(); }, [tenant?.id]);

  const openCreate = () => { setEditing(null); setForm({ name: '', code: '', address: '', phone: '', is_warehouse: false, is_active: true }); setOpen(true); };
  const openEdit = (s: any) => { setEditing(s); setForm({ ...s }); setOpen(true); };

  const save = async () => {
    if (!tenant || !form.name) { error('Nom obligatoire'); return; }
    setSaving(true);
    const payload = { tenant_id: tenant.id, name: form.name, code: form.code || '', address: form.address || '', phone: form.phone || '', is_warehouse: !!form.is_warehouse, is_active: form.is_active !== false };
    const { error: e } = editing
      ? await supabase.from('sites').update(payload).eq('id', editing.id)
      : await supabase.from('sites').insert(payload);
    setSaving(false);
    if (e) error(e.message); else { success(editing ? 'Modifié' : 'Créé'); setOpen(false); load(); refresh(); }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end"><button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" />Nouveau magasin</button></div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-600">
            <tr><th className="px-4 py-3 text-left">Nom</th><th className="px-4 py-3 text-left">Code</th><th className="px-4 py-3 text-left hidden sm:table-cell">Téléphone</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Statut</th><th className="px-4 py-3"></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.map(s => (
              <tr key={s.id} className="hover:bg-slate-50/60">
                <td className="px-4 py-3 font-medium">{s.name}</td>
                <td className="px-4 py-3 font-mono text-xs">{s.code}</td>
                <td className="px-4 py-3 hidden sm:table-cell text-slate-500">{s.phone || '—'}</td>
                <td className="px-4 py-3 text-center"><span className="badge bg-slate-100 text-slate-700">{s.is_warehouse ? 'Dépôt' : 'Magasin'}</span></td>
                <td className="px-4 py-3 text-center"><span className={`badge ${s.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{s.is_active ? 'Actif' : 'Inactif'}</span></td>
                <td className="px-4 py-3 text-right"><button onClick={() => openEdit(s)} className="p-1.5 rounded hover:bg-slate-100"><Edit2 className="w-4 h-4" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Modifier le magasin' : 'Nouveau magasin'} size="sm"
        footer={<><button onClick={() => setOpen(false)} className="btn-secondary">Annuler</button><button onClick={save} disabled={saving} className="btn-primary">{saving && <Loader2 className="w-4 h-4 animate-spin" />}Enregistrer</button></>}>
        <div className="space-y-3">
          <div><label className="label">Nom *</label><input value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} className="input" autoFocus={desktopAutoFocus} /></div>
          <div><label className="label">Code court</label><input value={form.code || ''} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} className="input" placeholder="EX: DAKAR-1" /></div>
          <div><label className="label">Téléphone</label><input value={form.phone || ''} onChange={e => setForm({ ...form, phone: e.target.value })} className="input" /></div>
          <div><label className="label">Adresse</label><input value={form.address || ''} onChange={e => setForm({ ...form, address: e.target.value })} className="input" /></div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!form.is_warehouse} onChange={e => setForm({ ...form, is_warehouse: e.target.checked })} className="w-4 h-4 rounded" />
              <span className="text-sm">Inclut un dépôt/entrepôt</span>
            </label>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.is_active !== false} onChange={e => setForm({ ...form, is_active: e.target.checked })} className="w-4 h-4 rounded" />
              <span className="text-sm">Actif</span>
            </label>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ===================== PAYMENTS ===================== */
function PaymentsTab() {
  const { tenant } = useApp();
  const { success, error } = useToast();
  const [list, setList] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!tenant) return;
    const { data } = await supabase.from('payment_methods').select('*').eq('tenant_id', tenant.id).order('sort_order');
    setList(data || []);
  };
  useEffect(() => { load(); }, [tenant?.id]);

  const toggleActive = async (m: any) => {
    await supabase.from('payment_methods').update({ is_active: !m.is_active }).eq('id', m.id);
    success(m.is_active ? 'Désactivé' : 'Activé'); load();
  };

  const save = async () => {
    if (!tenant || !form.name || !form.code) { error('Nom et code obligatoires'); return; }
    setSaving(true);
    const payload = { tenant_id: tenant.id, name: form.name, code: form.code.toUpperCase(), payment_type: form.payment_type || 'cash', account_code: form.account_code || '', is_active: form.is_active !== false, sort_order: Number(form.sort_order || 99) };
    const { error: e } = editing
      ? await supabase.from('payment_methods').update(payload).eq('id', editing.id)
      : await supabase.from('payment_methods').insert(payload);
    setSaving(false);
    if (e) error(e.message); else { success(editing ? 'Modifié' : 'Créé'); setOpen(false); load(); }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button onClick={() => { setEditing(null); setForm({ payment_type: 'cash', is_active: true, sort_order: list.length + 1 }); setOpen(true); }} className="btn-primary"><Plus className="w-4 h-4" />Nouveau mode</button>
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-600">
            <tr><th className="px-4 py-3 text-left">Nom</th><th className="px-4 py-3 text-left hidden sm:table-cell">Code</th><th className="px-4 py-3 text-left hidden md:table-cell">Type</th><th className="px-4 py-3 text-left hidden lg:table-cell">Compte</th><th className="px-4 py-3 text-center">Statut</th><th className="px-4 py-3"></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.map(m => (
              <tr key={m.id} className="hover:bg-slate-50/60">
                <td className="px-4 py-3 font-medium">{m.name}</td>
                <td className="px-4 py-3 hidden sm:table-cell font-mono text-xs">{m.code}</td>
                <td className="px-4 py-3 hidden md:table-cell capitalize text-slate-600">{m.payment_type}</td>
                <td className="px-4 py-3 hidden lg:table-cell font-mono text-xs text-slate-500">{m.account_code}</td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => toggleActive(m)} role="switch" aria-checked={m.is_active} title={m.is_active ? 'Cliquer pour désactiver' : 'Cliquer pour activer'} className={`relative inline-flex items-center w-11 h-6 rounded-full transition-all duration-300 ${m.is_active ? 'bg-gradient-to-r from-brand-500 to-brand-600 shadow-glow' : 'bg-slate-200'}`}>
                    <span className={`inline-block w-5 h-5 rounded-full bg-white shadow-md transform transition-all duration-300 ${m.is_active ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
                  </button>
                  <div className={`text-[9px] font-bold uppercase tracking-wider mt-1 ${m.is_active ? 'text-emerald-600' : 'text-slate-400'}`}>{m.is_active ? 'Actif' : 'Inactif'}</div>
                </td>
                <td className="px-4 py-3 text-right"><button onClick={() => { setEditing(m); setForm({ ...m }); setOpen(true); }} className="p-1.5 rounded hover:bg-slate-100"><Edit2 className="w-4 h-4" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Modifier le mode' : 'Nouveau mode de règlement'} size="sm"
        footer={<><button onClick={() => setOpen(false)} className="btn-secondary">Annuler</button><button onClick={save} disabled={saving} className="btn-primary">{saving && <Loader2 className="w-4 h-4 animate-spin" />}Enregistrer</button></>}>
        <div className="space-y-3">
          <div><label className="label">Nom *</label><input value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} className="input" autoFocus={desktopAutoFocus} /></div>
          <div><label className="label">Code *</label><input value={form.code || ''} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} className="input" placeholder="EX: WAVE" /></div>
          <div><label className="label">Type</label>
            <select value={form.payment_type || 'cash'} onChange={e => setForm({ ...form, payment_type: e.target.value })} className="input">
              <option value="cash">Espèces</option><option value="mobile">Mobile Money</option>
              <option value="card">Carte bancaire</option><option value="bank">Virement</option>
              <option value="check">Chèque</option><option value="credit">Crédit client</option>
            </select>
          </div>
          <div><label className="label">Compte comptable (7 chiffres)</label><input value={form.account_code || ''} onChange={e => setForm({ ...form, account_code: e.target.value })} className="input" placeholder="5710000" maxLength={7} /></div>
          <div><label className="label">Ordre d'affichage</label><input type="number" value={form.sort_order || 99} onChange={e => setForm({ ...form, sort_order: Number(e.target.value) })} className="input" /></div>
        </div>
      </Modal>
    </div>
  );
}

/* ===================== CATEGORIES ===================== */
function CategoriesTab() {
  const { tenant } = useApp();
  const { success, error } = useToast();
  const [list, setList] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [toDelete, setToDelete] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!tenant) return;
    const { data } = await supabase.from('part_categories').select('*').eq('tenant_id', tenant.id).order('name');
    setList(data || []);
  };
  useEffect(() => { load(); }, [tenant?.id]);

  const roots = list.filter(c => !c.parent_id);
  const children = (parentId: string) => list.filter(c => c.parent_id === parentId);

  const openCreate = (parentId?: string) => {
    setEditing(null);
    setForm({ name: '', code: '', parent_id: parentId || null, is_active: true });
    setOpen(true);
  };
  const openEdit = (c: any) => { setEditing(c); setForm({ ...c }); setOpen(true); };

  const save = async () => {
    if (!tenant || !form.name) { error('Nom obligatoire'); return; }
    setSaving(true);
    const payload = { tenant_id: tenant.id, name: form.name, code: form.code || '', parent_id: form.parent_id || null, is_active: form.is_active !== false };
    const { error: e } = editing
      ? await supabase.from('part_categories').update(payload).eq('id', editing.id)
      : await supabase.from('part_categories').insert(payload);
    setSaving(false);
    if (e) error(e.message); else { success(editing ? 'Modifié' : 'Créée'); setOpen(false); load(); }
  };

  const del = async () => {
    if (!toDelete) return;
    const { error: e } = await supabase.from('part_categories').update({ is_active: false }).eq('id', toDelete.id);
    if (e) error(e.message); else { success('Désactivée'); load(); }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end"><button onClick={() => openCreate()} className="btn-primary"><Plus className="w-4 h-4" />Nouvelle catégorie</button></div>
      <div className="card overflow-hidden">
        <div className="max-h-[520px] overflow-y-auto">
          {roots.length === 0 ? <div className="py-10 text-center text-sm text-slate-500">Aucune catégorie</div> : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-600 sticky top-0">
                <tr><th className="px-4 py-3 text-left">Catégorie</th><th className="px-4 py-3 text-left hidden sm:table-cell">Code</th><th className="px-4 py-3 text-center">Statut</th><th className="px-4 py-3 text-right">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {roots.map(cat => (
                  <>
                    <tr key={cat.id} className="bg-slate-50/60 hover:bg-slate-100/60">
                      <td className="px-4 py-2.5 font-semibold text-slate-800">{cat.name}</td>
                      <td className="px-4 py-2.5 font-mono text-xs hidden sm:table-cell">{cat.code}</td>
                      <td className="px-4 py-2.5 text-center"><span className={`badge ${cat.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{cat.is_active ? 'Active' : 'Inactive'}</span></td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="inline-flex gap-1">
                          <button onClick={() => openCreate(cat.id)} className="p-1.5 rounded hover:bg-brand-50 text-brand-700" title="Sous-catégorie"><Plus className="w-3.5 h-3.5" /></button>
                          <button onClick={() => openEdit(cat)} className="p-1.5 rounded hover:bg-slate-200"><Edit2 className="w-3.5 h-3.5" /></button>
                          <button onClick={() => setToDelete(cat)} className="p-1.5 rounded hover:bg-red-50 text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                    {children(cat.id).map(sub => (
                      <tr key={sub.id} className="hover:bg-slate-50/60">
                        <td className="px-4 py-2 pl-8 text-slate-700">↳ {sub.name}</td>
                        <td className="px-4 py-2 font-mono text-xs hidden sm:table-cell text-slate-400">{sub.code}</td>
                        <td className="px-4 py-2 text-center"><span className={`badge ${sub.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{sub.is_active ? 'Active' : 'Inactive'}</span></td>
                        <td className="px-4 py-2 text-right">
                          <div className="inline-flex gap-1">
                            <button onClick={() => openEdit(sub)} className="p-1.5 rounded hover:bg-slate-200"><Edit2 className="w-3.5 h-3.5" /></button>
                            <button onClick={() => setToDelete(sub)} className="p-1.5 rounded hover:bg-red-50 text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Modifier la catégorie' : (form.parent_id ? 'Nouvelle sous-catégorie' : 'Nouvelle catégorie principale')} size="sm"
        footer={<><button onClick={() => setOpen(false)} className="btn-secondary">Annuler</button><button onClick={save} disabled={saving} className="btn-primary">{saving && <Loader2 className="w-4 h-4 animate-spin" />}Enregistrer</button></>}>
        <div className="space-y-3">
          <div><label className="label">Nom *</label><input value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} className="input" autoFocus={desktopAutoFocus} /></div>
          <div><label className="label">Code</label><input value={form.code || ''} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} className="input" placeholder="EX: FIL-HUI" /></div>
          <div><label className="label">Catégorie parente</label>
            <select value={form.parent_id || ''} onChange={e => setForm({ ...form, parent_id: e.target.value || null })} className="input">
              <option value="">— Catégorie principale —</option>
              {list.filter(c => !c.parent_id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_active !== false} onChange={e => setForm({ ...form, is_active: e.target.checked })} className="w-4 h-4 rounded" />
            <span className="text-sm">Active</span>
          </label>
        </div>
      </Modal>

      <ConfirmDialog open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={del}
        title="Désactiver la catégorie ?" message={`"${toDelete?.name}" sera désactivée.`} danger />
    </div>
  );
}

/* ===================== BRANDS ===================== */
function BrandsTab() {
  const { tenant } = useApp();
  const { success, error } = useToast();
  const [brands, setBrands] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [openBrand, setOpenBrand] = useState(false);
  const [openModel, setOpenModel] = useState(false);
  const [editingBrand, setEditingBrand] = useState<any>(null);
  const [editingModel, setEditingModel] = useState<any>(null);
  const [brandForm, setBrandForm] = useState<any>({});
  const [modelForm, setModelForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [selectedBrand, setSelectedBrand] = useState<string>('');

  // Logo upload state
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string>('');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    if (!tenant) return;
    const [{ data: b }, { data: m }] = await Promise.all([
      supabase.from('vehicle_brands').select('*').eq('tenant_id', tenant.id).order('name'),
      supabase.from('vehicle_models').select('*').eq('tenant_id', tenant.id).order('name'),
    ]);
    setBrands(b || []);
    setModels(m || []);
    if (!selectedBrand && b?.length) setSelectedBrand(b[0].id);
  };
  useEffect(() => { load(); }, [tenant?.id]);

  const openBrandModal = (brand?: any) => {
    setEditingBrand(brand || null);
    setBrandForm(brand ? { ...brand } : { is_active: true });
    setLogoFile(null);
    setLogoPreview(brand?.logo_url || '');
    setOpenBrand(true);
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { error('Image trop lourde (max 2 Mo)'); return; }
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  };

  const uploadLogo = async (brandId: string): Promise<string | null> => {
    if (!logoFile || !tenant) return brandForm.logo_url || null;
    setUploadingLogo(true);
    const ext = logoFile.name.split('.').pop();
    const path = `${tenant.id}/${brandId}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('brand-logos')
      .upload(path, logoFile, { upsert: true, contentType: logoFile.type });
    setUploadingLogo(false);
    if (upErr) { error('Erreur upload: ' + upErr.message); return null; }
    const { data } = supabase.storage.from('brand-logos').getPublicUrl(path);
    return data.publicUrl + '?t=' + Date.now();
  };

  const removeLogo = () => {
    setLogoFile(null);
    setLogoPreview('');
    setBrandForm((f: any) => ({ ...f, logo_url: '' }));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const saveBrand = async () => {
    if (!tenant || !brandForm.name) { error('Nom obligatoire'); return; }
    setSaving(true);

    let logoUrl = brandForm.logo_url || null;

    if (editingBrand) {
      // Upload logo first if new file selected
      if (logoFile) {
        logoUrl = await uploadLogo(editingBrand.id);
        if (logoUrl === null && logoFile) { setSaving(false); return; }
      } else if (logoPreview === '') {
        logoUrl = null;
      }
      const { error: e } = await supabase.from('vehicle_brands').update({
        name: brandForm.name, is_active: brandForm.is_active !== false, logo_url: logoUrl,
      }).eq('id', editingBrand.id);
      setSaving(false);
      if (e) { error(e.message); return; }
    } else {
      // Create brand first, then upload logo with the new id
      const { data: newBrand, error: e } = await supabase.from('vehicle_brands').insert({
        tenant_id: tenant.id, name: brandForm.name, is_active: brandForm.is_active !== false, logo_url: null,
      }).select().single();
      if (e || !newBrand) { setSaving(false); error(e?.message || 'Erreur'); return; }
      if (logoFile) {
        logoUrl = await uploadLogo(newBrand.id);
        if (logoUrl) {
          await supabase.from('vehicle_brands').update({ logo_url: logoUrl }).eq('id', newBrand.id);
        }
      }
      setSaving(false);
    }

    success(editingBrand ? 'Modifiée' : 'Créée');
    setOpenBrand(false);
    load();
  };

  const saveModel = async () => {
    if (!tenant || !modelForm.name || !modelForm.brand_id) { error('Marque et nom obligatoires'); return; }
    setSaving(true);
    const payload = { tenant_id: tenant.id, brand_id: modelForm.brand_id, name: modelForm.name, year_start: Number(modelForm.year_start || 0), year_end: Number(modelForm.year_end || 0), engine: modelForm.engine || '', fuel: modelForm.fuel || '', is_active: true };
    const { error: e } = editingModel
      ? await supabase.from('vehicle_models').update(payload).eq('id', editingModel.id)
      : await supabase.from('vehicle_models').insert(payload);
    setSaving(false);
    if (e) error(e.message); else { success(editingModel ? 'Modifié' : 'Créé'); setOpenModel(false); load(); }
  };

  const filteredModels = models.filter(m => m.brand_id === selectedBrand);
  const brandName = brands.find(b => b.id === selectedBrand)?.name;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* Marques */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">Marques ({brands.length})</h3>
          <button onClick={() => openBrandModal()} className="btn-primary text-sm py-2"><Plus className="w-3.5 h-3.5" />Nouvelle marque</button>
        </div>
        <div className="card overflow-hidden max-h-[520px] overflow-y-auto">
          {brands.length === 0 ? <div className="py-8 text-center text-sm text-slate-500">Aucune marque</div> : (
            <div className="divide-y divide-slate-100">
              {brands.map(b => (
                <div key={b.id} onClick={() => setSelectedBrand(b.id)}
                  className={`flex items-center justify-between px-4 py-2.5 cursor-pointer transition-colors ${selectedBrand === b.id ? 'bg-brand-50' : 'hover:bg-slate-50'}`}>
                  <div className="flex items-center gap-3">
                    {/* Logo thumbnail */}
                    <div className="w-10 h-8 flex items-center justify-center overflow-hidden shrink-0">
                      {(() => {
                        const logo = getBrandLogo(b.name);
                        return logo
                          ? <div className="w-full h-full">{logo}</div>
                          : <Car className="w-5 h-5 text-slate-300" />;
                      })()}
                    </div>
                    <div>
                      <span className={`text-sm font-medium block ${selectedBrand === b.id ? 'text-brand-800' : 'text-slate-800'}`}>{b.name}</span>
                      <span className={`text-xs ${b.is_active ? 'text-emerald-600' : 'text-slate-400'}`}>{b.is_active ? 'Active' : 'Inactive'}</span>
                    </div>
                  </div>
                  <button onClick={ev => { ev.stopPropagation(); openBrandModal(b); }} className="p-1.5 rounded hover:bg-slate-200 text-slate-500"><Edit2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modèles */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">Modèles {brandName ? `— ${brandName}` : ''} ({filteredModels.length})</h3>
          <button onClick={() => { setEditingModel(null); setModelForm({ brand_id: selectedBrand, fuel: 'essence' }); setOpenModel(true); }} disabled={!selectedBrand} className="btn-primary text-sm py-2"><Plus className="w-3.5 h-3.5" />Nouveau modèle</button>
        </div>
        <div className="card overflow-hidden max-h-[520px] overflow-y-auto">
          {filteredModels.length === 0 ? <div className="py-8 text-center text-sm text-slate-500">Sélectionnez une marque</div> : (
            <div className="divide-y divide-slate-100">
              {filteredModels.map(m => (
                <div key={m.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-50">
                  <div>
                    <div className="text-sm font-medium">{m.name}</div>
                    <div className="text-xs text-slate-500">{m.year_start > 0 ? `${m.year_start}–${m.year_end || '…'}` : ''} {m.engine} {m.fuel}</div>
                  </div>
                  <button onClick={() => { setEditingModel(m); setModelForm({ ...m }); setOpenModel(true); }} className="p-1.5 rounded hover:bg-slate-200 text-slate-500"><Edit2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal marque avec upload logo */}
      <Modal open={openBrand} onClose={() => setOpenBrand(false)} title={editingBrand ? 'Modifier la marque' : 'Nouvelle marque'} size="sm"
        footer={<>
          <button onClick={() => setOpenBrand(false)} className="btn-secondary">Annuler</button>
          <button onClick={saveBrand} disabled={saving || uploadingLogo} className="btn-primary">
            {(saving || uploadingLogo) && <Loader2 className="w-4 h-4 animate-spin" />}
            Enregistrer
          </button>
        </>}>
        <div className="space-y-4">
          <div><label className="label">Nom de la marque *</label><input value={brandForm.name || ''} onChange={e => setBrandForm({ ...brandForm, name: e.target.value })} className="input" autoFocus={desktopAutoFocus} /></div>

          {/* Logo upload zone */}
          <div>
            <label className="label">Logo</label>
            <div className="flex items-start gap-3">
              {/* Preview */}
              <div className="w-20 h-20 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden shrink-0 relative group">
                {logoPreview ? (
                  <>
                    <img src={logoPreview} alt="Logo" className="w-full h-full object-contain p-2" />
                    <button
                      onClick={removeLogo}
                      className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity rounded-xl"
                    >
                      <X className="w-5 h-5 text-white" />
                    </button>
                  </>
                ) : (() => {
                  const inlineLogo = getBrandLogo(brandForm.name || '');
                  return inlineLogo ? (
                    <div className="w-full h-full p-2">{inlineLogo}</div>
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-slate-300">
                      <ImageOff className="w-6 h-6" />
                      <span className="text-[10px]">Aucun logo</span>
                    </div>
                  );
                })()}
              </div>
              {/* Upload controls */}
              <div className="flex-1 space-y-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/svg+xml"
                  onChange={handleLogoChange}
                  className="hidden"
                  id="brand-logo-upload"
                />
                <label htmlFor="brand-logo-upload" className="btn-secondary cursor-pointer w-full flex items-center justify-center gap-2 text-sm py-2">
                  <Upload className="w-4 h-4" />
                  {logoPreview ? 'Changer le logo' : 'Choisir un fichier'}
                </label>
                <p className="text-xs text-slate-400">JPG, PNG, WebP, SVG — max 2 Mo</p>
                {logoPreview && (
                  <button onClick={removeLogo} className="text-xs text-red-500 hover:underline flex items-center gap-1">
                    <X className="w-3 h-3" />Supprimer le logo
                  </button>
                )}
              </div>
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={brandForm.is_active !== false} onChange={e => setBrandForm({ ...brandForm, is_active: e.target.checked })} className="w-4 h-4 rounded" />
            <span className="text-sm">Active</span>
          </label>
        </div>
      </Modal>

      {/* Modal modèle */}
      <Modal open={openModel} onClose={() => setOpenModel(false)} title={editingModel ? 'Modifier le modèle' : 'Nouveau modèle'} size="sm"
        footer={<><button onClick={() => setOpenModel(false)} className="btn-secondary">Annuler</button><button onClick={saveModel} disabled={saving} className="btn-primary">{saving && <Loader2 className="w-4 h-4 animate-spin" />}Enregistrer</button></>}>
        <div className="space-y-3">
          <div><label className="label">Marque *</label>
            <select value={modelForm.brand_id || ''} onChange={e => setModelForm({ ...modelForm, brand_id: e.target.value })} className="input">
              <option value="">—</option>
              {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div><label className="label">Nom du modèle *</label><input value={modelForm.name || ''} onChange={e => setModelForm({ ...modelForm, name: e.target.value })} className="input" autoFocus={desktopAutoFocus} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">Année début</label><input type="number" value={modelForm.year_start || ''} onChange={e => setModelForm({ ...modelForm, year_start: Number(e.target.value) })} className="input" placeholder="2005" /></div>
            <div><label className="label">Année fin</label><input type="number" value={modelForm.year_end || ''} onChange={e => setModelForm({ ...modelForm, year_end: Number(e.target.value) })} className="input" placeholder="2015" /></div>
          </div>
          <div><label className="label">Motorisation</label><input value={modelForm.engine || ''} onChange={e => setModelForm({ ...modelForm, engine: e.target.value })} className="input" placeholder="1.6 VVTi, 2.5D 1KD..." /></div>
          <div><label className="label">Carburant</label>
            <select value={modelForm.fuel || 'essence'} onChange={e => setModelForm({ ...modelForm, fuel: e.target.value })} className="input">
              <option value="essence">Essence</option><option value="diesel">Diesel</option>
              <option value="hybride">Hybride</option><option value="electrique">Électrique</option>
            </select>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ===================== ACCOUNTING ===================== */
function AccountingTab() {
  const { tenant } = useApp();
  const { success, error } = useToast();
  const [list, setList] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!tenant) return;
    const { data } = await supabase.from('accounts').select('*').eq('tenant_id', tenant.id).order('code');
    setList(data || []);
  };
  useEffect(() => { load(); }, [tenant?.id]);

  const save = async () => {
    if (!tenant || !form.code || !form.name) { error('Code et intitulé obligatoires'); return; }
    if (form.code.length !== 7 || !/^\d+$/.test(form.code)) { error('Le code doit contenir exactement 7 chiffres'); return; }
    setSaving(true);
    const payload = { tenant_id: tenant.id, code: form.code, name: form.name, class: Number(form.code.charAt(0)), is_active: true };
    const { error: e } = editing
      ? await supabase.from('accounts').update({ name: form.name }).eq('id', editing.id)
      : await supabase.from('accounts').insert(payload);
    setSaving(false);
    if (e) error(e.message.includes('unique') ? 'Ce code existe déjà' : e.message); else { success(editing ? 'Modifié' : 'Créé'); setOpen(false); load(); }
  };

  const byClass = [1, 2, 3, 4, 5, 6, 7, 8].map(cl => ({
    cl, label: { 1: 'Ressources durables', 2: 'Actif immobilisé', 3: 'Stocks', 4: 'Tiers', 5: 'Trésorerie', 6: 'Charges', 7: 'Produits', 8: 'Autres' }[cl] || '', items: list.filter(a => a.class === cl),
  })).filter(g => g.items.length > 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{list.length} compte{list.length > 1 ? 's' : ''} — SYSCOHADA révisé (codes 7 chiffres)</p>
        <button onClick={() => { setEditing(null); setForm({}); setOpen(true); }} className="btn-primary"><Plus className="w-4 h-4" />Nouveau compte</button>
      </div>

      <div className="space-y-3">
        {byClass.map(({ cl, label, items }) => (
          <div key={cl} className="card overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
              <span className="w-6 h-6 rounded bg-brand-100 text-brand-800 text-xs font-bold flex items-center justify-center">{cl}</span>
              <span className="text-sm font-semibold text-slate-800">Classe {cl} — {label}</span>
              <span className="ml-auto text-xs text-slate-400">{items.length} comptes</span>
            </div>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {items.map(a => (
                  <tr key={a.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2.5 font-mono text-xs w-24">{a.code}</td>
                    <td className="px-4 py-2.5 font-medium">{a.name}</td>
                    <td className="px-4 py-2.5 text-right"><button onClick={() => { setEditing(a); setForm({ ...a }); setOpen(true); }} className="p-1 rounded hover:bg-slate-100"><Edit2 className="w-3.5 h-3.5 text-slate-400" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Modifier le compte' : 'Nouveau compte'} size="sm"
        footer={<><button onClick={() => setOpen(false)} className="btn-secondary">Annuler</button><button onClick={save} disabled={saving} className="btn-primary">{saving && <Loader2 className="w-4 h-4 animate-spin" />}Enregistrer</button></>}>
        <div className="space-y-3">
          <div>
            <label className="label">Code comptable (7 chiffres) *</label>
            <input value={form.code || ''} onChange={e => setForm({ ...form, code: e.target.value })} className="input font-mono" placeholder="5710000" maxLength={7} disabled={!!editing} />
            {form.code?.length === 7 && <p className="text-xs text-slate-500 mt-1">Classe {form.code.charAt(0)}</p>}
          </div>
          <div><label className="label">Intitulé *</label><input value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} className="input" /></div>
        </div>
      </Modal>
    </div>
  );
}

/* ===================== USERS ===================== */
const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super admin',
  admin: 'Admin',
  manager: 'Manager',
  cashier: 'Caissier',
  viewer: 'Consultation',
};

async function callAdminUsers(action: string, payload: Record<string, unknown> = {}) {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Erreur');
  return data;
}

function UsersTab() {
  const { profile } = useApp();
  const { success, error } = useToast();
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({ email: '', password: '', full_name: '', role: 'cashier' });
  const [saving, setSaving] = useState(false);
  const [resetFor, setResetFor] = useState<any>(null);
  const [newPass, setNewPass] = useState('');
  const [toDelete, setToDelete] = useState<any>(null);

  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin';

  const load = async () => {
    setLoading(true);
    try {
      const { users } = await callAdminUsers('list');
      setList(users || []);
    } catch (e: any) { error(e.message); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.email) { error('Email requis'); return; }
    setSaving(true);
    try {
      if (editing) {
        await callAdminUsers('update', { user_id: editing.id, full_name: form.full_name, role: form.role, is_active: form.is_active });
        success('Utilisateur mis à jour');
      } else {
        if (!form.password || form.password.length < 6) { error('Mot de passe min 6 caractères'); setSaving(false); return; }
        await callAdminUsers('create', { email: form.email, password: form.password, full_name: form.full_name, role: form.role });
        success('Utilisateur créé');
      }
      setOpen(false); setEditing(null); setForm({ email: '', password: '', full_name: '', role: 'cashier' });
      load();
    } catch (e: any) { error(e.message); }
    setSaving(false);
  };

  const doReset = async () => {
    if (!resetFor || !newPass || newPass.length < 6) { error('Mot de passe min 6 caractères'); return; }
    try {
      await callAdminUsers('reset_password', { user_id: resetFor.id, new_password: newPass });
      success('Mot de passe réinitialisé');
      setResetFor(null); setNewPass('');
    } catch (e: any) { error(e.message); }
  };

  const doDelete = async () => {
    if (!toDelete) return;
    try {
      await callAdminUsers('delete', { user_id: toDelete.id });
      success('Utilisateur supprimé');
      setToDelete(null); load();
    } catch (e: any) { error(e.message); }
  };

  if (!isAdmin) return (
    <div className="card p-8 text-center">
      <Shield className="w-10 h-10 text-slate-300 mx-auto mb-3" />
      <p className="text-sm text-slate-600 font-semibold">Accès réservé aux administrateurs</p>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{list.length} utilisateur{list.length > 1 ? 's' : ''}</p>
        <button
          onClick={() => { setEditing(null); setForm({ email: '', password: '', full_name: '', role: 'cashier' }); setOpen(true); }}
          className="btn-primary"
        ><Plus className="w-4 h-4" />Nouvel utilisateur</button>
      </div>

      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
      ) : (
        <div className="space-y-2">
          {list.map(u => (
            <div key={u.id} className="bg-white border border-slate-200/70 rounded-2xl shadow-card p-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 text-white flex items-center justify-center font-extrabold shrink-0">
                {(u.full_name || u.email).charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900 truncate">{u.full_name || u.email}</span>
                  {!u.is_active && <span className="text-[10px] bg-red-50 text-red-700 px-1.5 py-0.5 rounded">Inactif</span>}
                </div>
                <div className="text-xs text-slate-500 truncate">{u.email}</div>
              </div>
              <span className="shrink-0 text-[10px] uppercase tracking-wider font-bold text-brand-700 bg-brand-50 border border-brand-100 px-2 py-0.5 rounded-full">
                {ROLE_LABELS[u.role] || u.role}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => { setEditing(u); setForm({ ...u }); setOpen(true); }} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600" title="Modifier">
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => { setResetFor(u); setNewPass(''); }} className="p-1.5 rounded-lg hover:bg-amber-50 text-amber-600" title="Réinitialiser mot de passe">
                  <KeyRound className="w-3.5 h-3.5" />
                </button>
                {u.id !== profile?.id && (
                  <button onClick={() => setToDelete(u)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500" title="Supprimer">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? 'Modifier utilisateur' : 'Nouvel utilisateur'}
        size="md"
        footer={<><button onClick={() => setOpen(false)} className="btn-secondary">Annuler</button><button onClick={save} disabled={saving} className="btn-primary">{saving && <Loader2 className="w-4 h-4 animate-spin" />}{editing ? 'Enregistrer' : 'Créer'}</button></>}
      >
        <div className="space-y-3">
          <div>
            <label className="label">Email *</label>
            <input value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} disabled={!!editing} className="input" placeholder="user@exemple.com" />
          </div>
          <div>
            <label className="label">Nom complet</label>
            <input value={form.full_name || ''} onChange={e => setForm({ ...form, full_name: e.target.value })} className="input" />
          </div>
          {!editing && (
            <div>
              <label className="label">Mot de passe *</label>
              <input type="password" value={form.password || ''} onChange={e => setForm({ ...form, password: e.target.value })} className="input" placeholder="Min. 6 caractères" />
            </div>
          )}
          <div>
            <label className="label">Rôle</label>
            <select value={form.role || 'cashier'} onChange={e => setForm({ ...form, role: e.target.value })} className="input">
              {Object.entries(ROLE_LABELS).filter(([k]) => profile?.role === 'super_admin' || k !== 'super_admin').map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </select>
          </div>
          {editing && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.is_active !== false} onChange={e => setForm({ ...form, is_active: e.target.checked })} className="rounded" />
              Actif
            </label>
          )}
        </div>
      </Modal>

      <Modal
        open={!!resetFor}
        onClose={() => { setResetFor(null); setNewPass(''); }}
        title="Réinitialiser mot de passe"
        size="sm"
        footer={<><button onClick={() => { setResetFor(null); setNewPass(''); }} className="btn-secondary">Annuler</button><button onClick={doReset} className="btn-primary"><KeyRound className="w-4 h-4" />Réinitialiser</button></>}
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Définir un nouveau mot de passe pour <strong>{resetFor?.full_name || resetFor?.email}</strong>.
          </p>
          <div>
            <label className="label">Nouveau mot de passe *</label>
            <input type="password" value={newPass} onChange={e => setNewPass(e.target.value)} className="input" placeholder="Min. 6 caractères" />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={doDelete}
        title="Supprimer l'utilisateur ?"
        message={`Le compte "${toDelete?.email}" sera définitivement supprimé.`}
        danger
      />
    </div>
  );
}

