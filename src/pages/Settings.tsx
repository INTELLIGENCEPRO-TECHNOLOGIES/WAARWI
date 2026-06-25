import { useEffect, useRef, useState } from 'react';
import { Loader2, Save, Building2, Store, CreditCard, Tag, BookOpen, Plus, CreditCard as Edit2, Trash2, Car, Upload, X, ImageOff, ShoppingBag, ExternalLink, Copy, Check, Globe, ToggleLeft, ToggleRight, AlertCircle, Users, Shield, KeyRound, Image as ImageIcon, Database, ArrowLeft, Package, Settings as SettingsIcon, Link2, Share2, FileText, Layers, Printer } from 'lucide-react';
import { BackupTab } from '../components/BackupTab';
import { PermissionsTab } from '../components/PermissionsTab';
import { DocumentSettingsTab } from '../components/DocumentSettingsTab';
import { TicketHeaderConfigTab } from '../components/TicketHeaderConfigTab';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { Modal, ConfirmDialog } from '../components/Modal';
import { SearchableSelect } from '../components/SearchableSelect';
import { getBrandLogo } from '../lib/brandLogos';
import { desktopAutoFocus } from '../lib/device';

type TabKey = 'home' | 'company' | 'boutique' | 'users' | 'permissions' | 'sites' | 'payments' | 'categories' | 'brands' | 'accounting' | 'stock' | 'tiers' | 'pricing_tiers' | 'backup' | 'documents' | 'ticket_header';

type TileConfig = { k: TabKey; label: string; icon: any; color: string; bg: string };

export function Settings() {
  const { refresh, profile, tenant, sites } = useApp();
  const autoMode = (tenant?.business_type || 'auto_parts') === 'auto_parts';
  const [tab, setTab] = useState<TabKey>('home');

  const groups: { title: string; tiles: TileConfig[] }[] = [
    {
      title: 'Votre entreprise',
      tiles: [
        { k: 'company', label: 'Identification', icon: Building2, color: 'text-slate-700', bg: 'bg-slate-50 border-slate-200' },
        { k: 'users', label: 'Utilisateurs', icon: Users, color: 'text-neutral-800', bg: 'bg-neutral-50/80 border-neutral-200' },
        { k: 'permissions', label: 'Permissions', icon: Shield, color: 'text-rose-700', bg: 'bg-rose-50/80 border-rose-200' },
        { k: 'sites', label: 'Magasins', icon: Store, color: 'text-emerald-700', bg: 'bg-emerald-50/80 border-emerald-200' },
      ],
    },
    {
      title: 'Données de structure',
      tiles: [
        { k: 'categories', label: 'Catégories', icon: Tag, color: 'text-amber-700', bg: 'bg-amber-50/80 border-amber-200' },
        ...(autoMode ? [{ k: 'brands' as TabKey, label: 'Marques véhicules', icon: Car, color: 'text-neutral-800', bg: 'bg-neutral-50/80 border-neutral-200' }] : []),
        { k: 'payments', label: 'Modes de paiement', icon: CreditCard, color: 'text-teal-700', bg: 'bg-teal-50/80 border-teal-200' },
        { k: 'pricing_tiers', label: 'Catégories tarifaires', icon: Layers, color: 'text-neutral-800', bg: 'bg-neutral-50/80 border-neutral-200' },
        { k: 'stock', label: 'Gestion des stocks', icon: Package, color: 'text-orange-700', bg: 'bg-orange-50/80 border-orange-200' },
        { k: 'tiers', label: 'Tiers', icon: Users, color: 'text-lime-700', bg: 'bg-lime-50/80 border-lime-200' },
      ],
    },
    {
      title: 'Configuration avancée',
      tiles: [
        { k: 'accounting', label: 'Comptabilité', icon: BookOpen, color: 'text-cyan-700', bg: 'bg-cyan-50/80 border-cyan-200' },
        { k: 'boutique', label: 'Boutique en ligne', icon: ShoppingBag, color: 'text-pink-700', bg: 'bg-pink-50/80 border-pink-200' },
        { k: 'documents', label: 'Paramètres documents', icon: FileText, color: 'text-neutral-800', bg: 'bg-neutral-50/80 border-neutral-200' },
        { k: 'ticket_header', label: 'En-tête tickets', icon: Printer, color: 'text-fuchsia-700', bg: 'bg-fuchsia-50/80 border-fuchsia-200' },
        { k: 'backup', label: 'Sauvegarde', icon: Database, color: 'text-green-700', bg: 'bg-green-50/80 border-green-200' },
      ],
    },
  ];

  if (tab === 'home') {
    return (
      <div className="space-y-5">
        <div className="sticky top-0 z-10 -mx-3 sm:-mx-5 lg:-mx-8 px-3 sm:px-5 lg:px-8 pb-3 pt-3 sm:pt-4 lg:pt-6 -mt-3 sm:-mt-4 lg:-mt-6 bg-slate-50/95 backdrop-blur-sm flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 border border-slate-200/80 flex items-center justify-center shadow-sm">
            <SettingsIcon className="w-4.5 h-4.5 text-slate-600" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 tracking-tight">Paramètres</h1>
            <p className="text-[11px] text-slate-500">Configuration de votre entreprise et référentiels</p>
          </div>
        </div>

        {groups.map(g => (
          <div key={g.title}>
            <div className="flex items-center gap-3 mb-2.5">
              <h2 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap">{g.title}</h2>
              <div className="flex-1 h-px bg-slate-100" />
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2.5">
              {g.tiles.map(t => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.k}
                    onClick={() => setTab(t.k)}
                    className="group flex flex-col items-center gap-1.5 p-3 rounded-xl border border-slate-100 bg-white hover:border-slate-200 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
                  >
                    <div className={`w-10 h-10 rounded-lg border flex items-center justify-center ${t.bg} group-hover:scale-105 transition-transform`}>
                      <Icon className={`w-[18px] h-[18px] ${t.color}`} />
                    </div>
                    <span className="text-[10px] sm:text-[11px] font-semibold text-slate-600 text-center leading-tight">{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const currentLabel = groups.flatMap(g => g.tiles).find(t => t.k === tab)?.label || 'Paramètres';

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 -mx-3 sm:-mx-5 lg:-mx-8 px-3 sm:px-5 lg:px-8 py-2 pt-3 sm:pt-4 lg:pt-6 -mt-3 sm:-mt-4 lg:-mt-6 bg-slate-50/95 backdrop-blur-sm">
      <button onClick={() => setTab('home')} className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 hover:text-brand-900 transition-colors">
        <ArrowLeft className="w-3.5 h-3.5" />Paramètres / {currentLabel}
      </button>
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
      {tab === 'stock' && <StockSettingsTab onRefresh={refresh} />}
      {tab === 'tiers' && <TiersSettingsTab onRefresh={refresh} />}
      {tab === 'pricing_tiers' && <PricingTiersTab />}
      {tab === 'backup' && <BackupTab />}
      {tab === 'documents' && <DocumentSettingsTab />}
      {tab === 'ticket_header' && <TicketHeaderConfigTab />}
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
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Colonne gauche : identité + légal */}
      <div className="space-y-3">
        <div className="card p-4 space-y-3">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
            <div className="w-1 h-4 rounded-full bg-slate-400" />
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Identité visuelle</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
              {form.logo_url ? <img src={form.logo_url} alt="Logo" className="w-full h-full object-contain" /> : <ImageIcon className="w-5 h-5 text-slate-300" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-slate-500 mb-1.5">PNG, JPG, WebP ou SVG — max 2 Mo</p>
              <div className="flex items-center gap-2">
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f); e.target.value = ''; }} />
                <button onClick={() => fileRef.current?.click()} disabled={uploading} className="btn-secondary text-[11px] py-1.5 px-2.5">
                  {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                  {form.logo_url ? 'Remplacer' : 'Téléverser'}
                </button>
                {form.logo_url && (
                  <button onClick={removeLogo} className="text-[11px] text-red-600 hover:bg-red-50 px-2 py-1.5 rounded-lg flex items-center gap-1 transition">
                    <Trash2 className="w-3 h-3" />Retirer
                  </button>
                )}
              </div>
            </div>
          </div>
          <div><label className="label">Nom commercial *</label><input value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} className="input" /></div>
          <div><label className="label">Slogan</label><input value={form.slogan || ''} onChange={e => setForm({ ...form, slogan: e.target.value })} className="input" placeholder="Ex : Pièces auto de qualité, livrées rapidement." /></div>
        </div>

        <div className="card p-4 space-y-3">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
            <div className="w-1 h-4 rounded-full bg-slate-400" />
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Informations légales</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Raison sociale</label><input value={form.legal_name || ''} onChange={e => setForm({ ...form, legal_name: e.target.value })} className="input" /></div>
            <div><label className="label">NINEA</label><input value={form.ninea || ''} onChange={e => setForm({ ...form, ninea: e.target.value })} className="input" /></div>
            <div><label className="label">RCCM</label><input value={form.rccm || ''} onChange={e => setForm({ ...form, rccm: e.target.value })} className="input" /></div>
          </div>
        </div>
      </div>

      {/* Colonne droite : contact + préférences */}
      <div className="space-y-3">
        <div className="card p-4 space-y-3">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
            <div className="w-1 h-4 rounded-full bg-brand-500" />
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Coordonnées</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Téléphone</label><input value={form.phone || ''} onChange={e => setForm({ ...form, phone: e.target.value })} className="input" /></div>
            <div><label className="label">Email</label><input value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} className="input" /></div>
            <div className="col-span-2"><label className="label">Site web</label><input value={form.website || ''} onChange={e => setForm({ ...form, website: e.target.value })} className="input" placeholder="https://…" /></div>
            <div className="col-span-2"><label className="label">Adresse</label><textarea value={form.address || ''} onChange={e => setForm({ ...form, address: e.target.value })} className="input resize-none" rows={2} /></div>
          </div>
        </div>

        <div className="card p-4 space-y-3">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
            <div className="w-1 h-4 rounded-full bg-slate-400" />
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Préférences des rapports</span>
          </div>
          <SettingsToggle
            label="Afficher les marges dans les rapports"
            desc="Inclut la marge brute et le taux de marge dans les états de ventes"
            active={!!(tenant as any)?.settings?.show_margin_in_reports}
            onToggle={async () => {
              if (!tenant) return;
              const cur = (tenant as any)?.settings || {};
              const newVal = !cur.show_margin_in_reports;
              await supabase.from('tenants').update({ settings: { ...cur, show_margin_in_reports: newVal } }).eq('id', tenant.id);
              onRefresh();
            }}
          />
        </div>

        <div className="flex justify-end">
          <button onClick={save} disabled={saving} className="btn-primary text-sm">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}

/* ===================== TOGGLE COMPONENT ===================== */
function SettingsToggle({ label, desc, active, onToggle }: { label: string; desc: string; active: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50/80 border border-slate-200/80">
      <div className="flex-1 min-w-0 mr-3">
        <div className="text-xs font-semibold text-slate-700">{label}</div>
        <div className="text-[11px] text-slate-500 mt-0.5">{desc}</div>
      </div>
      <button type="button" onClick={onToggle} className="shrink-0">
        {active
          ? <ToggleRight className="w-8 h-8 text-brand-600" />
          : <ToggleLeft className="w-8 h-8 text-slate-300" />}
      </button>
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

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-brand-700" /></div>;

  if (!settings) return (
    <div className="card p-6 text-center text-slate-500">
      <AlertCircle className="w-7 h-7 mx-auto mb-2 text-amber-400" />
      <p className="font-medium text-sm">Paramètres boutique introuvables.</p>
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Colonne gauche : statut + URL */}
      <div className="space-y-3">
        {/* Statut */}
        <div className={`card p-4 border-l-4 ${settings.is_active ? 'border-l-emerald-500' : 'border-l-amber-400'}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${settings.is_active ? 'bg-emerald-50' : 'bg-amber-50'}`}>
                <Globe className={`w-4 h-4 ${settings.is_active ? 'text-emerald-600' : 'text-amber-600'}`} />
              </div>
              <div>
                <span className={`text-xs font-bold ${settings.is_active ? 'text-emerald-800' : 'text-amber-800'}`}>
                  Boutique {settings.is_active ? 'active' : 'inactive'}
                </span>
                <p className={`text-[11px] mt-0.5 ${settings.is_active ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {settings.is_active ? 'Visible par vos clients en ligne.' : 'Activez pour la rendre publique.'}
                </p>
              </div>
            </div>
            <button onClick={toggleActive} disabled={saving}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition ${
                settings.is_active ? 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}>
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : settings.is_active ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
              {settings.is_active ? 'Désactiver' : 'Activer'}
            </button>
          </div>
        </div>

        {/* URL publique */}
        <div className="card p-4 space-y-3">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
            <div className="w-1 h-4 rounded-full bg-brand-500" />
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Adresse publique</span>
          </div>
          <div>
            <label className="label">Slug URL</label>
            {editingSlug ? (
              <div className="flex gap-2">
                <div className="flex-1 flex items-center border border-brand-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-brand-500/30">
                  <span className="px-2.5 py-2 text-[11px] text-slate-400 bg-slate-50 border-r border-slate-200">/shop/</span>
                  <input value={slugInput} onChange={e => setSlugInput(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                    className="flex-1 px-2.5 py-2 text-sm outline-none font-mono" placeholder="mon-entreprise" autoFocus
                    onKeyDown={e => { if (e.key === 'Enter') saveSlug(); if (e.key === 'Escape') setEditingSlug(false); }} />
                </div>
                <button onClick={saveSlug} disabled={saving} className="btn-primary py-2 px-3">{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}</button>
                <button onClick={() => setEditingSlug(false)} className="btn-secondary py-2 px-3"><X className="w-3.5 h-3.5" /></button>
              </div>
            ) : (
              <div className="flex gap-2 items-center">
                <div className="flex-1 flex items-center border border-slate-200 rounded-lg bg-slate-50 overflow-hidden">
                  <span className="px-2.5 py-2 text-[11px] text-slate-400 border-r border-slate-200">/shop/</span>
                  <span className="flex-1 px-2.5 py-2 text-sm font-mono text-slate-800">{slug || '—'}</span>
                </div>
                <button onClick={() => { setSlugInput(slug); setEditingSlug(true); }} className="btn-secondary py-2 px-3 text-[11px]">
                  <Edit2 className="w-3.5 h-3.5" />Modifier
                </button>
              </div>
            )}
          </div>
          {slug && (
            <div className="bg-slate-50 rounded-lg p-3 space-y-2">
              <code className="text-xs text-brand-800 font-mono break-all block">{shopUrl}</code>
              <div className="flex gap-2">
                <button onClick={copyLink} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 text-[11px] font-semibold transition">
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copié !' : 'Copier le lien'}
                </button>
                <button onClick={openShop}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-semibold transition ${
                    settings.is_active ? 'bg-brand-700 hover:bg-brand-800 text-white' : 'bg-slate-200 hover:bg-slate-300 text-slate-600'}`}>
                  <ExternalLink className="w-3.5 h-3.5" />Voir la boutique
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Colonne droite : infos boutique */}
      <div className="space-y-3">
        <div className="card p-4 space-y-3">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
            <div className="w-1 h-4 rounded-full bg-pink-500" />
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Informations boutique</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><label className="label">Nom affiché</label><input value={settings.shop_name || ''} onChange={e => setSettings({ ...settings, shop_name: e.target.value })} className="input" /></div>
            <div className="col-span-2"><label className="label">Accroche</label><input value={settings.tagline || ''} onChange={e => setSettings({ ...settings, tagline: e.target.value })} className="input" placeholder="Ex : Pièces auto de qualité" /></div>
            <div><label className="label">Téléphone</label><input value={settings.phone || ''} onChange={e => setSettings({ ...settings, phone: e.target.value })} className="input" /></div>
            <div><label className="label">WhatsApp</label><input value={settings.whatsapp || ''} onChange={e => setSettings({ ...settings, whatsapp: e.target.value })} className="input" /></div>
            <div className="col-span-2"><label className="label">Adresse</label><input value={settings.address || ''} onChange={e => setSettings({ ...settings, address: e.target.value })} className="input" /></div>
            <div className="col-span-2"><label className="label">Message d'accueil</label><textarea value={settings.welcome_msg || ''} onChange={e => setSettings({ ...settings, welcome_msg: e.target.value })} className="input resize-none" rows={2} /></div>
            <div className="col-span-2"><label className="label">Pied de page</label><input value={settings.footer_text || ''} onChange={e => setSettings({ ...settings, footer_text: e.target.value })} className="input" /></div>
          </div>
          <div className="flex justify-end pt-1">
            <button onClick={saveSettings} disabled={saving} className="btn-primary text-sm">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Enregistrer
            </button>
          </div>
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
    const { data } = await supabase.from('sites').select('*').eq('tenant_id', tenant.id).order('is_warehouse').order('name');
    setList(data || []);
  };
  useEffect(() => { load(); }, [tenant?.id]);

  const stores = list.filter(s => !s.is_warehouse);
  const depots = list.filter(s => s.is_warehouse);

  const openCreateStore = () => { setEditing(null); setForm({ name: '', code: '', address: '', phone: '', is_warehouse: false, is_active: true, parent_site_id: null }); setOpen(true); };
  const openCreateDepot = () => { setEditing(null); setForm({ name: '', code: '', address: '', phone: '', is_warehouse: true, is_active: true, parent_site_id: stores[0]?.id || '' }); setOpen(true); };
  const openEdit = (s: any) => { setEditing(s); setForm({ ...s }); setOpen(true); };

  const save = async () => {
    if (!tenant || !form.name) { error('Nom obligatoire'); return; }
    if (form.is_warehouse && !form.parent_site_id) { error('Sélectionnez le magasin rattaché'); return; }
    setSaving(true);
    const payload: any = {
      tenant_id: tenant.id, name: form.name, code: form.code || '',
      address: form.address || '', phone: form.phone || '',
      is_warehouse: !!form.is_warehouse, is_active: form.is_active !== false,
      parent_site_id: form.is_warehouse ? form.parent_site_id : null,
    };
    const { error: e } = editing
      ? await supabase.from('sites').update(payload).eq('id', editing.id)
      : await supabase.from('sites').insert(payload);
    setSaving(false);
    if (e) error(e.message); else { success(editing ? 'Modifié' : 'Créé'); setOpen(false); load(); refresh(); }
  };

  return (
    <div className="space-y-4">
      {/* Magasins section */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Magasins</h3>
          <button onClick={openCreateStore} className="btn-primary text-sm"><Plus className="w-3.5 h-3.5" />Nouveau magasin</button>
        </div>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-bold">
              <tr><th className="px-3 py-2.5 text-left">Nom</th><th className="px-3 py-2.5 text-left">Code</th><th className="px-3 py-2.5 text-left hidden sm:table-cell">Téléphone</th><th className="px-3 py-2.5 text-center">Statut</th><th className="px-3 py-2.5"></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {stores.map(s => (
                <tr key={s.id} className="hover:bg-slate-50/60">
                  <td className="px-3 py-2.5 font-medium text-sm">{s.name}</td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-slate-500">{s.code || '—'}</td>
                  <td className="px-3 py-2.5 hidden sm:table-cell text-xs text-slate-500">{s.phone || '—'}</td>
                  <td className="px-3 py-2.5 text-center"><span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${s.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{s.is_active ? 'Actif' : 'Inactif'}</span></td>
                  <td className="px-3 py-2.5 text-right"><button onClick={() => openEdit(s)} className="p-1 rounded hover:bg-slate-100"><Edit2 className="w-3.5 h-3.5 text-slate-400" /></button></td>
                </tr>
              ))}
              {stores.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-xs text-slate-400">Aucun magasin</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Depots section */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Dépôts / Entrepôts</h3>
          <button onClick={openCreateDepot} className="btn-secondary text-sm"><Plus className="w-3.5 h-3.5" />Nouveau dépôt</button>
        </div>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-bold">
              <tr><th className="px-3 py-2.5 text-left">Nom</th><th className="px-3 py-2.5 text-left">Code</th><th className="px-3 py-2.5 text-left">Magasin rattaché</th><th className="px-3 py-2.5 text-center">Statut</th><th className="px-3 py-2.5"></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {depots.map(d => {
                const parentStore = stores.find(s => s.id === d.parent_site_id);
                return (
                  <tr key={d.id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2.5 font-medium text-sm">{d.name}</td>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-slate-500">{d.code || '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">{parentStore?.name || <span className="text-amber-600 italic">Non rattaché</span>}</td>
                    <td className="px-3 py-2.5 text-center"><span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${d.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{d.is_active ? 'Actif' : 'Inactif'}</span></td>
                    <td className="px-3 py-2.5 text-right"><button onClick={() => openEdit(d)} className="p-1 rounded hover:bg-slate-100"><Edit2 className="w-3.5 h-3.5 text-slate-400" /></button></td>
                  </tr>
                );
              })}
              {depots.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-xs text-slate-400">Aucun dépôt créé</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? (form.is_warehouse ? 'Modifier le dépôt' : 'Modifier le magasin') : (form.is_warehouse ? 'Nouveau dépôt' : 'Nouveau magasin')} size="sm"
        footer={<><button onClick={() => setOpen(false)} className="btn-secondary">Annuler</button><button onClick={save} disabled={saving} className="btn-primary">{saving && <Loader2 className="w-4 h-4 animate-spin" />}Enregistrer</button></>}>
        <div className="space-y-3">
          <div><label className="label">Nom *</label><input value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} className="input" autoFocus={desktopAutoFocus} /></div>
          <div><label className="label">Code court</label><input value={form.code || ''} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} className="input" placeholder="EX: DEP-01" /></div>
          <div><label className="label">Téléphone</label><input value={form.phone || ''} onChange={e => setForm({ ...form, phone: e.target.value })} className="input" /></div>
          <div><label className="label">Adresse</label><input value={form.address || ''} onChange={e => setForm({ ...form, address: e.target.value })} className="input" /></div>
          {form.is_warehouse && (
            <div>
              <label className="label">Magasin rattaché *</label>
              <select value={form.parent_site_id || ''} onChange={e => setForm({ ...form, parent_site_id: e.target.value })} className="input">
                <option value="">— Sélectionner —</option>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <p className="text-[10px] text-slate-400 mt-1">Seul ce magasin pourra vendre depuis ce dépôt (sauf si transfert inter-dépôts activé).</p>
            </div>
          )}
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.is_active !== false} onChange={e => setForm({ ...form, is_active: e.target.checked })} className="w-4 h-4 rounded" /><span className="text-sm">Actif</span></label>
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
        <button onClick={() => { setEditing(null); setForm({ payment_type: 'cash', is_active: true, sort_order: list.length + 1 }); setOpen(true); }} className="btn-primary text-sm"><Plus className="w-3.5 h-3.5" />Nouveau mode</button>
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-bold">
            <tr><th className="px-3 py-2.5 text-left">Nom</th><th className="px-3 py-2.5 text-left hidden sm:table-cell">Code</th><th className="px-3 py-2.5 text-left hidden md:table-cell">Type</th><th className="px-3 py-2.5 text-left hidden lg:table-cell">Compte</th><th className="px-3 py-2.5 text-center">Statut</th><th className="px-3 py-2.5"></th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.map(m => (
              <tr key={m.id} className="hover:bg-slate-50/60">
                <td className="px-3 py-2.5 font-medium">{m.name}</td>
                <td className="px-3 py-2.5 hidden sm:table-cell font-mono text-[11px] text-slate-500">{m.code}</td>
                <td className="px-3 py-2.5 hidden md:table-cell capitalize text-xs text-slate-500">{m.payment_type}</td>
                <td className="px-3 py-2.5 hidden lg:table-cell font-mono text-[11px] text-slate-400">{m.account_code}</td>
                <td className="px-3 py-2.5 text-center">
                  <button onClick={() => toggleActive(m)} className={`relative inline-flex items-center w-9 h-5 rounded-full transition-all ${m.is_active ? 'bg-brand-500' : 'bg-slate-200'}`}>
                    <span className={`inline-block w-4 h-4 rounded-full bg-white shadow transform transition-all ${m.is_active ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                  </button>
                </td>
                <td className="px-3 py-2.5 text-right"><button onClick={() => { setEditing(m); setForm({ ...m }); setOpen(true); }} className="p-1 rounded hover:bg-slate-100"><Edit2 className="w-3.5 h-3.5 text-slate-400" /></button></td>
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
      <div className="flex justify-end"><button onClick={() => openCreate()} className="btn-primary text-sm"><Plus className="w-3.5 h-3.5" />Nouvelle catégorie</button></div>
      <div className="card overflow-hidden">
        <div className="max-h-[520px] overflow-y-auto">
          {roots.length === 0 ? <div className="py-8 text-center text-sm text-slate-500">Aucune catégorie</div> : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 font-bold sticky top-0">
                <tr><th className="px-3 py-2.5 text-left">Catégorie</th><th className="px-3 py-2.5 text-left hidden sm:table-cell">Code</th><th className="px-3 py-2.5 text-center">Statut</th><th className="px-3 py-2.5 text-right">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {roots.map(cat => (
                  <>{/* Fragment per root */}
                    <tr key={cat.id} className="bg-slate-50/60 hover:bg-slate-100/60">
                      <td className="px-3 py-2 font-semibold text-slate-800 text-sm">{cat.name}</td>
                      <td className="px-3 py-2 font-mono text-[11px] hidden sm:table-cell text-slate-500">{cat.code}</td>
                      <td className="px-3 py-2 text-center"><span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cat.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{cat.is_active ? 'Active' : 'Inactive'}</span></td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex gap-0.5">
                          <button onClick={() => openCreate(cat.id)} className="p-1 rounded hover:bg-brand-50 text-brand-700" title="Sous-catégorie"><Plus className="w-3 h-3" /></button>
                          <button onClick={() => openEdit(cat)} className="p-1 rounded hover:bg-slate-200"><Edit2 className="w-3 h-3" /></button>
                          <button onClick={() => setToDelete(cat)} className="p-1 rounded hover:bg-red-50 text-red-500"><Trash2 className="w-3 h-3" /></button>
                        </div>
                      </td>
                    </tr>
                    {children(cat.id).map(sub => (
                      <tr key={sub.id} className="hover:bg-slate-50/60">
                        <td className="px-3 py-2 pl-7 text-slate-600 text-sm">↳ {sub.name}</td>
                        <td className="px-3 py-2 font-mono text-[11px] hidden sm:table-cell text-slate-400">{sub.code}</td>
                        <td className="px-3 py-2 text-center"><span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${sub.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{sub.is_active ? 'Active' : 'Inactive'}</span></td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex gap-0.5">
                            <button onClick={() => openEdit(sub)} className="p-1 rounded hover:bg-slate-200"><Edit2 className="w-3 h-3" /></button>
                            <button onClick={() => setToDelete(sub)} className="p-1 rounded hover:bg-red-50 text-red-500"><Trash2 className="w-3 h-3" /></button>
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

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Modifier la catégorie' : (form.parent_id ? 'Nouvelle sous-catégorie' : 'Nouvelle catégorie')} size="sm"
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
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.is_active !== false} onChange={e => setForm({ ...form, is_active: e.target.checked })} className="w-4 h-4 rounded" /><span className="text-sm">Active</span></label>
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
    const { error: upErr } = await supabase.storage.from('brand-logos').upload(path, logoFile, { upsert: true, contentType: logoFile.type });
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
      if (logoFile) { logoUrl = await uploadLogo(editingBrand.id); if (logoUrl === null && logoFile) { setSaving(false); return; } }
      else if (logoPreview === '') { logoUrl = null; }
      const { error: e } = await supabase.from('vehicle_brands').update({ name: brandForm.name, is_active: brandForm.is_active !== false, logo_url: logoUrl }).eq('id', editingBrand.id);
      setSaving(false);
      if (e) { error(e.message); return; }
    } else {
      const { data: newBrand, error: e } = await supabase.from('vehicle_brands').insert({ tenant_id: tenant.id, name: brandForm.name, is_active: brandForm.is_active !== false, logo_url: null }).select().single();
      if (e || !newBrand) { setSaving(false); error(e?.message || 'Erreur'); return; }
      if (logoFile) { logoUrl = await uploadLogo(newBrand.id); if (logoUrl) { await supabase.from('vehicle_brands').update({ logo_url: logoUrl }).eq('id', newBrand.id); } }
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
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Marques */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">Marques ({brands.length})</h3>
          <button onClick={() => openBrandModal()} className="btn-primary text-[11px] py-1.5"><Plus className="w-3 h-3" />Ajouter</button>
        </div>
        <div className="card overflow-hidden max-h-[480px] overflow-y-auto">
          {brands.length === 0 ? <div className="py-6 text-center text-xs text-slate-500">Aucune marque</div> : (
            <div className="divide-y divide-slate-100">
              {brands.map(b => (
                <div key={b.id} onClick={() => setSelectedBrand(b.id)}
                  className={`flex items-center justify-between px-3 py-2 cursor-pointer transition-colors ${selectedBrand === b.id ? 'bg-brand-50' : 'hover:bg-slate-50'}`}>
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-7 flex items-center justify-center overflow-hidden shrink-0">
                      {(() => { const logo = getBrandLogo(b.name); return logo ? <div className="w-full h-full">{logo}</div> : <Car className="w-4 h-4 text-slate-300" />; })()}
                    </div>
                    <div>
                      <span className={`text-xs font-medium block ${selectedBrand === b.id ? 'text-brand-800' : 'text-slate-800'}`}>{b.name}</span>
                      <span className={`text-[10px] ${b.is_active ? 'text-emerald-600' : 'text-slate-400'}`}>{b.is_active ? 'Active' : 'Inactive'}</span>
                    </div>
                  </div>
                  <button onClick={ev => { ev.stopPropagation(); openBrandModal(b); }} className="p-1 rounded hover:bg-slate-200 text-slate-400"><Edit2 className="w-3 h-3" /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modèles */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">Modèles {brandName ? `— ${brandName}` : ''} ({filteredModels.length})</h3>
          <button onClick={() => { setEditingModel(null); setModelForm({ brand_id: selectedBrand, fuel: 'essence' }); setOpenModel(true); }} disabled={!selectedBrand} className="btn-primary text-[11px] py-1.5"><Plus className="w-3 h-3" />Ajouter</button>
        </div>
        <div className="card overflow-hidden max-h-[480px] overflow-y-auto">
          {filteredModels.length === 0 ? <div className="py-6 text-center text-xs text-slate-500">Sélectionnez une marque</div> : (
            <div className="divide-y divide-slate-100">
              {filteredModels.map(m => (
                <div key={m.id} className="flex items-center justify-between px-3 py-2 hover:bg-slate-50">
                  <div>
                    <div className="text-xs font-medium">{m.name}</div>
                    <div className="text-[10px] text-slate-500">{m.year_start > 0 ? `${m.year_start}–${m.year_end || '…'}` : ''} {m.engine} {m.fuel}</div>
                  </div>
                  <button onClick={() => { setEditingModel(m); setModelForm({ ...m }); setOpenModel(true); }} className="p-1 rounded hover:bg-slate-200 text-slate-400"><Edit2 className="w-3 h-3" /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal marque */}
      <Modal open={openBrand} onClose={() => setOpenBrand(false)} title={editingBrand ? 'Modifier la marque' : 'Nouvelle marque'} size="sm"
        footer={<><button onClick={() => setOpenBrand(false)} className="btn-secondary">Annuler</button><button onClick={saveBrand} disabled={saving || uploadingLogo} className="btn-primary">{(saving || uploadingLogo) && <Loader2 className="w-4 h-4 animate-spin" />}Enregistrer</button></>}>
        <div className="space-y-3">
          <div><label className="label">Nom de la marque *</label><input value={brandForm.name || ''} onChange={e => setBrandForm({ ...brandForm, name: e.target.value })} className="input" autoFocus={desktopAutoFocus} /></div>
          <div>
            <label className="label">Logo</label>
            <div className="flex items-start gap-3">
              <div className="w-16 h-16 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden shrink-0 relative group">
                {logoPreview ? (
                  <>
                    <img src={logoPreview} alt="Logo" className="w-full h-full object-contain p-1.5" />
                    <button onClick={removeLogo} className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity rounded-xl"><X className="w-4 h-4 text-white" /></button>
                  </>
                ) : (() => { const inlineLogo = getBrandLogo(brandForm.name || ''); return inlineLogo ? <div className="w-full h-full p-1.5">{inlineLogo}</div> : <ImageOff className="w-5 h-5 text-slate-300" />; })()}
              </div>
              <div className="flex-1 space-y-1.5">
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml" onChange={handleLogoChange} className="hidden" id="brand-logo-upload" />
                <label htmlFor="brand-logo-upload" className="btn-secondary cursor-pointer w-full flex items-center justify-center gap-1.5 text-[11px] py-1.5"><Upload className="w-3.5 h-3.5" />{logoPreview ? 'Changer' : 'Choisir'}</label>
                <p className="text-[10px] text-slate-400">JPG, PNG, WebP, SVG — max 2 Mo</p>
                {logoPreview && <button onClick={removeLogo} className="text-[10px] text-red-500 hover:underline flex items-center gap-0.5"><X className="w-2.5 h-2.5" />Supprimer</button>}
              </div>
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={brandForm.is_active !== false} onChange={e => setBrandForm({ ...brandForm, is_active: e.target.checked })} className="w-4 h-4 rounded" /><span className="text-sm">Active</span></label>
        </div>
      </Modal>

      {/* Modal modèle */}
      <Modal open={openModel} onClose={() => setOpenModel(false)} title={editingModel ? 'Modifier le modèle' : 'Nouveau modèle'} size="sm"
        footer={<><button onClick={() => setOpenModel(false)} className="btn-secondary">Annuler</button><button onClick={saveModel} disabled={saving} className="btn-primary">{saving && <Loader2 className="w-4 h-4 animate-spin" />}Enregistrer</button></>}>
        <div className="space-y-3">
          <div><label className="label">Marque *</label>
            <SearchableSelect options={brands.map(b => ({ value: b.id, label: b.name }))} value={modelForm.brand_id || ''} onChange={v => setModelForm({ ...modelForm, brand_id: v })} placeholder="— Choisir —" />
          </div>
          <div><label className="label">Nom du modèle *</label><input value={modelForm.name || ''} onChange={e => setModelForm({ ...modelForm, name: e.target.value })} className="input" autoFocus={desktopAutoFocus} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">Année début</label><input type="number" value={modelForm.year_start || ''} onChange={e => setModelForm({ ...modelForm, year_start: Number(e.target.value) })} className="input" placeholder="2005" /></div>
            <div><label className="label">Année fin</label><input type="number" value={modelForm.year_end || ''} onChange={e => setModelForm({ ...modelForm, year_end: Number(e.target.value) })} className="input" placeholder="2015" /></div>
          </div>
          <div><label className="label">Motorisation</label><input value={modelForm.engine || ''} onChange={e => setModelForm({ ...modelForm, engine: e.target.value })} className="input" placeholder="1.6 VVTi, 2.5D..." /></div>
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
        <p className="text-xs text-slate-500">{list.length} compte{list.length > 1 ? 's' : ''} — SYSCOHADA révisé</p>
        <button onClick={() => { setEditing(null); setForm({}); setOpen(true); }} className="btn-primary text-sm"><Plus className="w-3.5 h-3.5" />Nouveau compte</button>
      </div>

      <div className="space-y-2">
        {byClass.map(({ cl, label, items }) => (
          <div key={cl} className="card overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
              <span className="w-5 h-5 rounded bg-brand-100 text-brand-800 text-[10px] font-bold flex items-center justify-center">{cl}</span>
              <span className="text-xs font-semibold text-slate-800">Classe {cl} — {label}</span>
              <span className="ml-auto text-[10px] text-slate-400">{items.length}</span>
            </div>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {items.map(a => (
                  <tr key={a.id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2 font-mono text-[11px] w-20 text-slate-600">{a.code}</td>
                    <td className="px-3 py-2 text-xs font-medium">{a.name}</td>
                    <td className="px-3 py-2 text-right"><button onClick={() => { setEditing(a); setForm({ ...a }); setOpen(true); }} className="p-1 rounded hover:bg-slate-100"><Edit2 className="w-3 h-3 text-slate-400" /></button></td>
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
            {form.code?.length === 7 && <p className="text-[10px] text-slate-500 mt-0.5">Classe {form.code.charAt(0)}</p>}
          </div>
          <div><label className="label">Intitulé *</label><input value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} className="input" /></div>
        </div>
      </Modal>
    </div>
  );
}

/* ===================== USERS ===================== */
const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super administrateur',
  admin: 'Administrateur',
  manager: 'Responsable',
  cashier: 'Caissier(ère)',
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
  const { profile, tenant } = useApp();
  const { success, error } = useToast();
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({ email: '', password: '', full_name: '', role: 'cashier', assigned_site_ids: [] });
  const [saving, setSaving] = useState(false);
  const [resetFor, setResetFor] = useState<any>(null);
  const [newPass, setNewPass] = useState('');
  const [toDelete, setToDelete] = useState<any>(null);
  const [allSites, setAllSites] = useState<any[]>([]);

  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin';

  const load = async () => {
    setLoading(true);
    try {
      const [{ users }, { data: sitesData }] = await Promise.all([
        callAdminUsers('list'),
        supabase.from('sites').select('id, name, code, is_active').eq('tenant_id', tenant!.id).order('name'),
      ]);
      setList(users || []);
      setAllSites(sitesData || []);
    } catch (e: any) { error(e.message); }
    setLoading(false);
  };
  useEffect(() => { if (tenant) load(); }, [tenant?.id]);

  const save = async () => {
    if (!form.email) { error('Email requis'); return; }
    setSaving(true);
    try {
      if (editing) {
        await callAdminUsers('update', { user_id: editing.id, full_name: form.full_name, role: form.role, is_active: form.is_active });
        const siteIds = (form.assigned_site_ids && form.assigned_site_ids.length > 0) ? form.assigned_site_ids : null;
        await supabase.from('profiles').update({ assigned_site_ids: siteIds } as any).eq('id', editing.id);
        success('Utilisateur mis à jour');
      } else {
        if (!form.password || form.password.length < 6) { error('Mot de passe min 6 caractères'); setSaving(false); return; }
        await callAdminUsers('create', { email: form.email, password: form.password, full_name: form.full_name, role: form.role });
        success('Utilisateur créé');
      }
      setOpen(false); setEditing(null); setForm({ email: '', password: '', full_name: '', role: 'cashier', assigned_site_ids: [] });
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
    <div className="card p-6 text-center">
      <Shield className="w-8 h-8 text-slate-300 mx-auto mb-2" />
      <p className="text-xs text-slate-600 font-semibold">Accès réservé aux administrateurs</p>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">{list.length} utilisateur{list.length > 1 ? 's' : ''}</p>
        <button onClick={() => { setEditing(null); setForm({ email: '', password: '', full_name: '', role: 'cashier', assigned_site_ids: [] }); setOpen(true); }} className="btn-primary text-sm"><Plus className="w-3.5 h-3.5" />Nouvel utilisateur</button>
      </div>

      {loading ? (
        <div className="py-12 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-brand-700" /></div>
      ) : (
        <div className="space-y-1.5">
          {list.map(u => (
            <div key={u.id} className="bg-white border border-slate-200/70 rounded-xl p-2.5 flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-600 to-brand-800 text-white flex items-center justify-center text-xs font-bold shrink-0">
                {(u.full_name || u.email).charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-slate-900 truncate">{u.full_name || u.email}</span>
                  {!u.is_active && <span className="text-[9px] bg-red-50 text-red-700 px-1 py-0.5 rounded">Inactif</span>}
                </div>
                <div className="text-[10px] text-slate-500 truncate">{u.email}</div>
              </div>
              <span className="shrink-0 text-[9px] uppercase tracking-wider font-bold text-brand-700 bg-brand-50 border border-brand-100 px-1.5 py-0.5 rounded-full">
                {ROLE_LABELS[u.role] || u.role}
              </span>
              <div className="flex items-center gap-0.5 shrink-0">
                <button onClick={async () => {
                  const { data: prof } = await supabase.from('profiles').select('assigned_site_ids').eq('id', u.id).maybeSingle();
                  setEditing(u); setForm({ ...u, assigned_site_ids: (prof as any)?.assigned_site_ids || [] }); setOpen(true);
                }} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" title="Modifier"><Edit2 className="w-3 h-3" /></button>
                <button onClick={() => { setResetFor(u); setNewPass(''); }} className="p-1.5 rounded-lg hover:bg-amber-50 text-amber-600" title="Mot de passe"><KeyRound className="w-3 h-3" /></button>
                {u.id !== profile?.id && (
                  <button onClick={() => setToDelete(u)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500" title="Supprimer"><Trash2 className="w-3 h-3" /></button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Modifier l\'utilisateur' : 'Nouvel utilisateur'} size="md"
        footer={<><button onClick={() => setOpen(false)} className="btn-secondary">Annuler</button><button onClick={save} disabled={saving} className="btn-primary">{saving && <Loader2 className="w-4 h-4 animate-spin" />}{editing ? 'Enregistrer' : 'Créer'}</button></>}>
        <div className="space-y-3">
          <div><label className="label">Email *</label><input value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} disabled={!!editing} className="input" placeholder="utilisateur@exemple.com" /></div>
          <div><label className="label">Nom complet</label><input value={form.full_name || ''} onChange={e => setForm({ ...form, full_name: e.target.value })} className="input" /></div>
          {!editing && (
            <div><label className="label">Mot de passe *</label><input type="password" value={form.password || ''} onChange={e => setForm({ ...form, password: e.target.value })} className="input" placeholder="Min. 6 caractères" /></div>
          )}
          <div><label className="label">Rôle</label>
            <select value={form.role || 'cashier'} onChange={e => setForm({ ...form, role: e.target.value })} className="input">
              {Object.entries(ROLE_LABELS).filter(([k]) => profile?.role === 'super_admin' || k !== 'super_admin').map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </select>
          </div>
          {allSites.length > 1 && (
            <div>
              <label className="label">Magasins assignés</label>
              <p className="text-[10px] text-slate-500 mb-1.5">Si aucun n'est sélectionné, l'utilisateur a accès à tous les magasins.</p>
              <div className="space-y-0.5 max-h-36 overflow-y-auto rounded-lg border border-slate-200 p-1.5">
                {allSites.filter(s => s.is_active).map(site => {
                  const checked = (form.assigned_site_ids || []).includes(site.id);
                  return (
                    <label key={site.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors">
                      <input type="checkbox" checked={checked}
                        onChange={e => {
                          const ids = form.assigned_site_ids || [];
                          setForm({ ...form, assigned_site_ids: e.target.checked ? [...ids, site.id] : ids.filter((x: string) => x !== site.id) });
                        }}
                        className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                      <span className="text-xs text-slate-800 font-medium">{site.name}</span>
                      {site.code && <span className="text-[9px] text-slate-400 font-mono">{site.code}</span>}
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          {editing && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.is_active !== false} onChange={e => setForm({ ...form, is_active: e.target.checked })} className="rounded" /> Actif
            </label>
          )}
        </div>
      </Modal>

      <Modal open={!!resetFor} onClose={() => { setResetFor(null); setNewPass(''); }} title="Réinitialiser le mot de passe" size="sm"
        footer={<><button onClick={() => { setResetFor(null); setNewPass(''); }} className="btn-secondary">Annuler</button><button onClick={doReset} className="btn-primary"><KeyRound className="w-3.5 h-3.5" />Réinitialiser</button></>}>
        <div className="space-y-3">
          <p className="text-xs text-slate-600">Nouveau mot de passe pour <strong>{resetFor?.full_name || resetFor?.email}</strong>.</p>
          <div><label className="label">Nouveau mot de passe *</label><input type="password" value={newPass} onChange={e => setNewPass(e.target.value)} className="input" placeholder="Min. 6 caractères" /></div>
        </div>
      </Modal>

      <ConfirmDialog open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={doDelete}
        title="Supprimer l'utilisateur ?" message={`Le compte "${toDelete?.email}" sera définitivement supprimé.`} danger />
    </div>
  );
}

/* ===================== STOCK SETTINGS ===================== */
type StockMethod = 'none' | 'cmup' | 'lot';

const STOCK_METHODS: { value: StockMethod; label: string; desc: string }[] = [
  { value: 'none', label: 'Aucune valorisation', desc: 'Le coût d\'achat est saisi manuellement par article. Pas de calcul automatique.' },
  { value: 'cmup', label: 'CMUP (Coût Moyen Unitaire Pondéré)', desc: 'Le prix d\'achat moyen est recalculé automatiquement à chaque entrée en stock.' },
  { value: 'lot', label: 'Suivi par lot', desc: 'Traçabilité par lot avec dates de péremption. Idéal pour pharmacies, alimentaire et cosmétiques.' },
];

function StockSettingsTab({ onRefresh }: { onRefresh: () => void }) {
  const { tenant, sites, depots } = useApp();
  const { success } = useToast();

  const settings = (tenant as any)?.settings || {};
  const allowNegative = !!settings.allow_negative_stock;
  const stockMethod: StockMethod = settings.stock_method || 'none';
  const sharedArticles = settings.shared_articles !== false;
  const interDepotTransfer = !!settings.inter_depot_transfer;
  const isMultiSite = sites.length > 1;
  const hasDepots = depots.length > 0;

  const updateSetting = async (key: string, value: any) => {
    if (!tenant) return;
    const cur = (tenant as any)?.settings || {};
    await supabase.from('tenants').update({ settings: { ...cur, [key]: value } }).eq('id', tenant.id);
    onRefresh();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Colonne gauche : contrôle + méthode */}
      <div className="space-y-3">
        <div className="card p-4 space-y-3">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
            <div className="w-1 h-4 rounded-full bg-orange-500" />
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Contrôle du stock</span>
          </div>
          <SettingsToggle
            label="Autoriser les stocks négatifs"
            desc="Permet de vendre des articles même si le stock est à zéro ou insuffisant."
            active={allowNegative}
            onToggle={async () => {
              await updateSetting('allow_negative_stock', !allowNegative);
              success(!allowNegative ? 'Stock négatif autorisé' : 'Stock négatif désactivé');
            }}
          />
          {allowNegative && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200">
              <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-800">Les ventes ne seront plus bloquées par le stock. Régularisez les entrées pour éviter les écarts.</p>
            </div>
          )}
        </div>

        <div className="card p-4 space-y-3">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
            <div className="w-1 h-4 rounded-full bg-orange-500" />
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Méthode de valorisation</span>
          </div>
          <p className="text-[11px] text-slate-500">Définit comment calculer la valeur du stock et les marges.</p>
          <div className="space-y-2">
            {STOCK_METHODS.map(m => {
              const active = stockMethod === m.value;
              return (
                <button key={m.value}
                  onClick={() => { updateSetting('stock_method', m.value); success('Méthode mise à jour'); }}
                  className={`w-full text-left p-2.5 rounded-xl border-2 transition-all ${active ? 'border-brand-500 bg-brand-50/60' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                  <div className="flex items-center gap-2.5">
                    <div className={`w-3 h-3 rounded-full border-2 shrink-0 flex items-center justify-center ${active ? 'border-brand-600' : 'border-slate-300'}`}>
                      {active && <div className="w-1.5 h-1.5 rounded-full bg-brand-600" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-xs font-semibold ${active ? 'text-brand-800' : 'text-slate-700'}`}>{m.label}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5 leading-tight">{m.desc}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          {stockMethod === 'lot' && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-neutral-50 border border-neutral-200">
              <AlertCircle className="w-3.5 h-3.5 text-neutral-700 shrink-0 mt-0.5" />
              <p className="text-[11px] text-neutral-800">Suivi par lot actif — dates de péremption et alertes disponibles.</p>
            </div>
          )}
          {stockMethod === 'cmup' && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-teal-50 border border-teal-200">
              <AlertCircle className="w-3.5 h-3.5 text-teal-600 shrink-0 mt-0.5" />
              <p className="text-[11px] text-teal-800">CMUP actif — le prix moyen est recalculé automatiquement à chaque entrée.</p>
            </div>
          )}
        </div>
      </div>

      {/* Colonne droite : catalogue multi-magasins */}
      <div className="space-y-3">
        {isMultiSite ? (
          <div className="card p-4 space-y-3">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
              <div className="w-1 h-4 rounded-full bg-brand-500" />
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Catalogue articles</span>
              <span className="ml-auto text-[10px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{sites.length} magasins</span>
            </div>
            <p className="text-[11px] text-slate-500">Partagé entre tous les magasins ou catalogue indépendant par site.</p>
            <div className="space-y-2">
              {[
                { val: true, label: 'Catalogue partagé', desc: 'Même catalogue pour tous. Transfert de stock possible.' },
                { val: false, label: 'Catalogues indépendants', desc: 'Chaque magasin gère ses propres articles. Pas de transfert.' },
              ].map(opt => {
                const active = sharedArticles === opt.val;
                return (
                  <button key={String(opt.val)}
                    onClick={() => { updateSetting('shared_articles', opt.val); success(opt.val ? 'Catalogue partagé activé' : 'Catalogues indépendants activés'); }}
                    className={`w-full text-left p-2.5 rounded-xl border-2 transition-all ${active ? 'border-brand-500 bg-brand-50/60' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                    <div className="flex items-center gap-2.5">
                      <div className={`w-3 h-3 rounded-full border-2 shrink-0 flex items-center justify-center ${active ? 'border-brand-600' : 'border-slate-300'}`}>
                        {active && <div className="w-1.5 h-1.5 rounded-full bg-brand-600" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={`text-xs font-semibold ${active ? 'text-brand-800' : 'text-slate-700'}`}>{opt.label}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">{opt.desc}</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className={`flex items-start gap-2 p-2.5 rounded-lg ${sharedArticles ? 'bg-emerald-50 border border-emerald-200' : 'bg-slate-50 border border-slate-200'}`}>
              <Share2 className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${sharedArticles ? 'text-emerald-600' : 'text-slate-400'}`} />
              <p className={`text-[11px] ${sharedArticles ? 'text-emerald-800' : 'text-slate-600'}`}>
                {sharedArticles
                  ? `Transferts de stock activés entre vos ${sites.length} magasins (page Stock).`
                  : 'Articles isolés par magasin. Créés dans un site, invisibles dans les autres.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="card p-4 flex items-start gap-3 bg-slate-50/50">
            <AlertCircle className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-slate-600">Options multi-magasins</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Disponibles dès que vous ajoutez un deuxième magasin dans Paramètres → Magasins.</p>
            </div>
          </div>
        )}

        {hasDepots && (
          <div className="card p-4 space-y-3">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
              <div className="w-1 h-4 rounded-full bg-amber-500" />
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Dépôts</span>
              <span className="ml-auto text-[10px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{depots.length} dépôt{depots.length > 1 ? 's' : ''}</span>
            </div>
            <SettingsToggle
              label="Transferts inter-dépôts"
              desc="Permet à tous les magasins d'accéder aux dépôts des autres magasins pour vendre ou transférer."
              active={interDepotTransfer}
              onToggle={async () => {
                await updateSetting('inter_depot_transfer', !interDepotTransfer);
                success(!interDepotTransfer ? 'Transferts inter-dépôts activés' : 'Transferts inter-dépôts désactivés');
              }}
            />
            {interDepotTransfer && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200">
                <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-800">Tous les magasins peuvent accéder à tous les dépôts. Désactivez pour limiter l'accès au magasin rattaché uniquement.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ===================== TIERS SETTINGS ===================== */
function TiersSettingsTab({ onRefresh }: { onRefresh: () => void }) {
  const { tenant, sites } = useApp();
  const { success } = useToast();

  const settings = (tenant as any)?.settings || {};
  const sharedCustomers = settings.shared_customers !== false;
  const sharedSuppliers = settings.shared_suppliers !== false;
  const isMultiSite = sites.length > 1;

  const updateSetting = async (key: string, value: any) => {
    if (!tenant) return;
    const cur = (tenant as any)?.settings || {};
    await supabase.from('tenants').update({ settings: { ...cur, [key]: value } }).eq('id', tenant.id);
    onRefresh();
  };

  const RadioBlock = ({ value, selected, label, desc, onSelect }: { value: boolean; selected: boolean; label: string; desc: string; onSelect: () => void }) => (
    <button
      onClick={onSelect}
      className={`w-full text-left p-2.5 rounded-xl border-2 transition-all ${selected ? 'border-brand-500 bg-brand-50/60' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
      <div className="flex items-center gap-2.5">
        <div className={`w-3 h-3 rounded-full border-2 shrink-0 flex items-center justify-center ${selected ? 'border-brand-600' : 'border-slate-300'}`}>
          {selected && <div className="w-1.5 h-1.5 rounded-full bg-brand-600" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-xs font-semibold ${selected ? 'text-brand-800' : 'text-slate-700'}`}>{label}</div>
          <div className="text-[10px] text-slate-500 mt-0.5 leading-tight">{desc}</div>
        </div>
      </div>
    </button>
  );

  if (!isMultiSite) {
    return (
      <div className="card p-5 flex items-start gap-3 max-w-xl">
        <AlertCircle className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-semibold text-slate-600">Options multi-magasins</p>
          <p className="text-[11px] text-slate-500 mt-0.5">Ces paramètres deviennent disponibles dès que vous ajoutez un deuxième magasin dans <strong>Paramètres → Magasins</strong>.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Clients */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
          <div className="w-1 h-4 rounded-full bg-neutral-500" />
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Clients</span>
          <span className="ml-auto text-[10px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{sites.length} magasins</span>
        </div>
        <p className="text-[11px] text-slate-500">Définissez si les clients sont partagés entre tous les magasins ou gérés séparément.</p>
        <div className="space-y-2">
          <RadioBlock
            value={true} selected={sharedCustomers}
            label="Clients partagés"
            desc="Tous les magasins voient et partagent la même base clients."
            onSelect={() => { updateSetting('shared_customers', true); success('Clients partagés activés'); }}
          />
          <RadioBlock
            value={false} selected={!sharedCustomers}
            label="Clients indépendants"
            desc="Chaque magasin gère sa propre base clients, invisible dans les autres."
            onSelect={() => { updateSetting('shared_customers', false); success('Clients indépendants activés'); }}
          />
        </div>
        <div className={`flex items-start gap-2 p-2.5 rounded-lg ${sharedCustomers ? 'bg-neutral-50 border border-neutral-200' : 'bg-slate-50 border border-slate-200'}`}>
          <Users className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${sharedCustomers ? 'text-neutral-700' : 'text-slate-400'}`} />
          <p className={`text-[11px] ${sharedCustomers ? 'text-neutral-800' : 'text-slate-600'}`}>
            {sharedCustomers
              ? 'Base clients commune — un client créé dans un magasin est visible partout.'
              : 'Clients isolés — un client créé dans un magasin reste invisible dans les autres.'}
          </p>
        </div>
      </div>

      {/* Fournisseurs */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
          <div className="w-1 h-4 rounded-full bg-orange-500" />
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Fournisseurs</span>
          <span className="ml-auto text-[10px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{sites.length} magasins</span>
        </div>
        <p className="text-[11px] text-slate-500">Définissez si les fournisseurs et commandes sont partagés ou gérés par site.</p>
        <div className="space-y-2">
          <RadioBlock
            value={true} selected={sharedSuppliers}
            label="Fournisseurs partagés"
            desc="Base fournisseurs commune. Réception d'une commande = dispatch entre magasins."
            onSelect={() => { updateSetting('shared_suppliers', true); success('Fournisseurs partagés activés'); }}
          />
          <RadioBlock
            value={false} selected={!sharedSuppliers}
            label="Fournisseurs indépendants"
            desc="Chaque magasin gère ses propres fournisseurs et commandes."
            onSelect={() => { updateSetting('shared_suppliers', false); success('Fournisseurs indépendants activés'); }}
          />
        </div>
        <div className={`flex items-start gap-2 p-2.5 rounded-lg ${sharedSuppliers ? 'bg-orange-50 border border-orange-200' : 'bg-slate-50 border border-slate-200'}`}>
          <Package className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${sharedSuppliers ? 'text-orange-600' : 'text-slate-400'}`} />
          <p className={`text-[11px] ${sharedSuppliers ? 'text-orange-800' : 'text-slate-600'}`}>
            {sharedSuppliers
              ? 'Fournisseurs communs — lors de la réception, vous pouvez dispatcher le stock entre vos magasins.'
              : 'Fournisseurs isolés par magasin — commandes et stocks indépendants.'}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ===================== PRICING TIERS ===================== */
function PricingTiersTab() {
  const { tenant } = useApp();
  const { success, error } = useToast();
  const [tiers, setTiers] = useState<{ id: string; tier_name: string; sort_order: number; is_default: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [toDelete, setToDelete] = useState<string | null>(null);

  const load = async () => {
    if (!tenant) return;
    const { data } = await supabase.from('pricing_tier_definitions').select('*').eq('tenant_id', tenant.id).order('sort_order');
    setTiers(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [tenant?.id]);

  const addTier = async () => {
    if (!tenant || !newName.trim()) return;
    setAdding(true);
    const nextOrder = tiers.length;
    const { error: e } = await supabase.from('pricing_tier_definitions').insert({
      tenant_id: tenant.id,
      tier_name: newName.trim(),
      sort_order: nextOrder,
      is_default: tiers.length === 0,
    });
    if (e) error(e.message);
    else { success('Catégorie tarifaire ajoutée'); setNewName(''); await load(); }
    setAdding(false);
  };

  const deleteTier = async (id: string) => {
    const tierDef = tiers.find(t => t.id === id);
    if (tierDef && tenant) {
      await supabase.from('article_pricing_tiers').delete().eq('tenant_id', tenant.id).eq('tier_name', tierDef.tier_name);
    }
    const { error: e } = await supabase.from('pricing_tier_definitions').delete().eq('id', id);
    if (e) error(e.message);
    else { success('Catégorie supprimée'); await load(); }
    setToDelete(null);
  };

  const setDefault = async (id: string) => {
    if (!tenant) return;
    await supabase.from('pricing_tier_definitions').update({ is_default: false }).eq('tenant_id', tenant.id);
    await supabase.from('pricing_tier_definitions').update({ is_default: true }).eq('id', id);
    await load();
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>;

  return (
    <div className="space-y-5 max-w-xl">
      <div className="rounded-2xl bg-white shadow-card border border-slate-100 p-5 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Catégories tarifaires</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Définissez vos grilles tarifaires (ex : Détail, Semi-gros, Grossiste). Pour chaque article, vous pourrez ensuite attribuer un prix par catégorie. Lors d'une vente, si un article a plusieurs tarifs, le vendeur choisira lequel appliquer.
          </p>
        </div>

        {tiers.length === 0 ? (
          <div className="text-center py-6 text-xs text-slate-400">
            Aucune catégorie tarifaire définie. Ajoutez-en une pour commencer.
          </div>
        ) : (
          <div className="space-y-2">
            {tiers.map(t => (
              <div key={t.id} className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50/50">
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-semibold text-slate-900">{t.tier_name}</span>
                  {t.is_default && <span className="ml-2 text-[9px] font-bold uppercase tracking-wider text-brand-700 bg-brand-50 px-1.5 py-0.5 rounded-full border border-brand-200">Par défaut</span>}
                </div>
                {!t.is_default && (
                  <button onClick={() => setDefault(t.id)} className="text-[10px] font-semibold text-slate-500 hover:text-brand-700 px-2 py-1 rounded-lg hover:bg-brand-50">
                    Définir par défaut
                  </button>
                )}
                <button onClick={() => setToDelete(t.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addTier(); }}
            placeholder="Nom du tarif (ex : Grossiste)"
            className="premium-input text-sm flex-1"
          />
          <button onClick={addTier} disabled={adding || !newName.trim()} className="px-4 py-2.5 rounded-xl bg-brand-600 text-white text-xs font-bold shadow-glow hover:bg-brand-700 disabled:opacity-50 inline-flex items-center gap-1.5">
            {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Ajouter
          </button>
        </div>
      </div>

      <div className="rounded-xl bg-neutral-50 border border-neutral-200 p-4">
        <h4 className="text-xs font-bold text-neutral-800 mb-1">Comment utiliser les catégories tarifaires</h4>
        <ol className="text-[11px] text-neutral-800 space-y-1 list-decimal list-inside">
          <li>Ajoutez vos catégories ici (ex : Détail, Semi-gros, Grossiste)</li>
          <li>Dans la fiche article, onglet "Prix et tarifs", renseignez un prix par catégorie</li>
          <li>Lors de la vente (POS ou Facturation), si l'article a plusieurs tarifs, un sélecteur s'affiche</li>
          <li>Si un seul tarif est défini, il s'applique automatiquement sans sélecteur</li>
        </ol>
      </div>

      <ConfirmDialog open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={() => toDelete && deleteTier(toDelete)} title="Supprimer cette catégorie tarifaire ?" message="Les prix associés à cette catégorie seront supprimés pour tous les articles." confirmLabel="Supprimer" danger />
    </div>
  );
}
