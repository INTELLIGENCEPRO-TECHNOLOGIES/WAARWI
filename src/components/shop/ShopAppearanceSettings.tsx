import { useEffect, useRef, useState } from 'react';
import { Loader2, Save, Upload, Trash2, Eye, EyeOff, RotateCcw, Check, Image as ImageIcon } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import type { ShopSettings } from '../../lib/shopTypes';
import { SHOP_THEMES } from '../../lib/shopThemes';

type Props = {
  settings: ShopSettings;
  onSettingsChange: (s: ShopSettings) => void;
};

export function ShopAppearanceSettings({ settings, onSettingsChange }: Props) {
  const { tenant } = useApp();
  const { success, error } = useToast();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [focalDragging, setFocalDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const focalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focalDragging) return;
    const end = () => setFocalDragging(false);
    window.addEventListener('mouseup', end);
    window.addEventListener('touchend', end);
    return () => {
      window.removeEventListener('mouseup', end);
      window.removeEventListener('touchend', end);
    };
  }, [focalDragging]);

  const update = (patch: Partial<ShopSettings>) => {
    onSettingsChange({ ...settings, ...patch });
  };

  const saveAppearance = async () => {
    if (!tenant) return;
    setSaving(true);
    const { error: e } = await supabase
      .from('shop_settings')
      .update({
        theme: settings.theme,
        secondary_color: settings.secondary_color,
        cover_image_url: settings.cover_image_url,
        cover_image_alt: settings.cover_image_alt,
        cover_focal_x: settings.cover_focal_x,
        cover_focal_y: settings.cover_focal_y,
        cover_overlay: settings.cover_overlay,
        cover_overlay_intensity: settings.cover_overlay_intensity,
        show_references: settings.show_references,
        show_stock: settings.show_stock,
        low_stock_threshold: settings.low_stock_threshold,
        show_perks: settings.show_perks,
        card_density: settings.card_density,
        section_order: settings.section_order,
        hero_title: settings.hero_title,
        hero_subtitle: settings.hero_subtitle,
        hero_cta_label: settings.hero_cta_label,
        promo_banner_text: settings.promo_banner_text,
        promo_banner_color: settings.promo_banner_color,
        promo_banner_active: settings.promo_banner_active,
        social_links: settings.social_links,
        show_waarwi_badge: settings.show_waarwi_badge,
      })
      .eq('tenant_id', tenant.id);
    setSaving(false);
    if (e) error(e.message);
    else success('Apparence enregistrée');
  };

  const uploadCover = async (file: File) => {
    if (!tenant) return;
    if (file.size > 5 * 1024 * 1024) { error('Image max 5 Mo'); return; }
    setUploading(true);
    try {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
      const maxW = 1920, maxH = 800;
      let w = img.width, h = img.height;
      if (w > maxW) { h = (h * maxW) / w; w = maxW; }
      if (h > maxH) { w = (w * maxH) / h; h = maxH; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas non supporté');
      ctx.drawImage(img, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
      if (!blob) throw new Error('Conversion WebP échouée');
      const path = `${tenant.id}/covers/cover-${Date.now()}.webp`;
      const { error: upErr } = await supabase.storage.from('tenant-logos').upload(path, blob, { upsert: true, contentType: 'image/webp', cacheControl: '3600' });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('tenant-logos').getPublicUrl(path);
      update({ cover_image_url: urlData.publicUrl });
      success('Image de couverture mise à jour');
    } catch (e: any) {
      error(e.message || 'Erreur lors de l\'upload');
    } finally {
      setUploading(false);
    }
  };

  const removeCover = () => {
    update({ cover_image_url: '', cover_image_alt: '', cover_focal_x: 50, cover_focal_y: 50 });
    success('Image de couverture retirée');
  };

  const handleFocalDrag = (e: React.MouseEvent | React.TouchEvent) => {
    if (!focalRef.current) return;
    const rect = focalRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const x = Math.round(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)));
    const y = Math.round(Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100)));
    update({ cover_focal_x: x, cover_focal_y: y });
  };

  const startFocalDrag = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setFocalDragging(true);
    handleFocalDrag(e);
  };

  const resetDefaults = () => {
    update({
      theme: 'premium_minimal',
      secondary_color: '#0f172a',
      cover_overlay: 'dark',
      cover_overlay_intensity: 40,
      cover_focal_x: 50,
      cover_focal_y: 50,
      show_references: true,
      show_stock: true,
      low_stock_threshold: 3,
      show_perks: true,
      card_density: 'comfortable',
      section_order: ['hero', 'categories', 'products', 'perks', 'footer'],
      hero_title: '',
      hero_subtitle: '',
      hero_cta_label: 'Découvrir les produits',
      promo_banner_text: '',
      promo_banner_color: '#dc2626',
      promo_banner_active: false,
      social_links: {},
      show_waarwi_badge: true,
    });
    success('Apparence réinitialisée');
  };

  return (
    <div className="space-y-0 flat-form">
      <h2 className="text-xs font-bold text-neutral-400 uppercase tracking-wider pb-4">Apparence</h2>

      {/* Theme selector */}
      <div className="py-4 border-t border-neutral-200">
        <span className="text-xs font-medium text-neutral-700 block mb-3">Thème</span>
        <div className="grid grid-cols-3 gap-2">
          {Object.values(SHOP_THEMES).map((t) => {
            const selected = settings.theme === t.id;
            return (
              <button
                key={t.id}
                onClick={() => update({ theme: t.id })}
                className={`relative py-2.5 px-3 text-center rounded-md border transition-all ${selected ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-200 hover:border-neutral-300'}`}
              >
                <div className={`text-[11px] font-medium ${selected ? 'text-neutral-900' : 'text-neutral-600'}`}>{t.label}</div>
                {selected && <Check className="absolute top-1.5 right-1.5 w-3 h-3 text-neutral-900" />}
              </button>
            );
          })}
        </div>
        <p className="text-[10px] text-neutral-500 mt-2">{SHOP_THEMES[settings.theme]?.description}</p>
      </div>

      {/* Cover image (immersive only) */}
      {settings.theme === 'immersive' && (
        <div className="py-4 border-t border-neutral-200 space-y-3">
          <span className="text-xs font-medium text-neutral-700 block">Image de couverture</span>
          {settings.cover_image_url ? (
            <div className="space-y-3">
              <div
                ref={focalRef}
                className="relative aspect-video rounded-md overflow-hidden bg-neutral-900 cursor-crosshair select-none"
                onMouseDown={startFocalDrag}
                onTouchStart={startFocalDrag}
                onMouseMove={(e) => focalDragging && handleFocalDrag(e)}
                onTouchMove={(e) => focalDragging && handleFocalDrag(e)}
              >
                <img src={settings.cover_image_url} alt={settings.cover_image_alt || 'Cover'} className="absolute inset-0 w-full h-full object-cover" style={{ objectPosition: `${settings.cover_focal_x}% ${settings.cover_focal_y}%`, transform: 'scale(1.5)' }} draggable={false} />
                <div className="absolute w-6 h-6 -translate-x-1/2 -translate-y-1/2 pointer-events-none" style={{ left: `${settings.cover_focal_x}%`, top: `${settings.cover_focal_y}%` }}>
                  <div className="w-6 h-6 rounded-full border-2 border-white shadow-lg flex items-center justify-center"><div className="w-2 h-2 rounded-full bg-white" /></div>
                </div>
                <div className="absolute bottom-1.5 left-1.5 px-2 py-0.5 rounded bg-black/50 text-white text-[9px] font-medium backdrop-blur-sm">Point focal</div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Voile</label>
                  <div className="flex gap-1">
                    {(['dark', 'light', 'none'] as const).map((o) => (
                      <button key={o} onClick={() => update({ cover_overlay: o })} className={`flex-1 py-1.5 text-[10px] font-medium rounded-md transition-all ${settings.cover_overlay === o ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'}`}>
                        {o === 'dark' ? 'Sombre' : o === 'light' ? 'Clair' : 'Aucun'}
                      </button>
                    ))}
                  </div>
                </div>
                {settings.cover_overlay !== 'none' && (
                  <div>
                    <label className="label">Intensité: {settings.cover_overlay_intensity}%</label>
                    <input type="range" min={0} max={100} value={settings.cover_overlay_intensity} onChange={(e) => update({ cover_overlay_intensity: Number(e.target.value) })} className="w-full accent-neutral-900" />
                  </div>
                )}
              </div>

              <div><label className="label">Texte alternatif</label><input value={settings.cover_image_alt} onChange={(e) => update({ cover_image_alt: e.target.value })} className="input" placeholder="Description (accessibilité)" /></div>

              <div className="flex gap-3">
                <button onClick={() => fileRef.current?.click()} disabled={uploading} className="text-xs font-medium text-neutral-500 hover:text-neutral-900 transition">
                  {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1" /> : <Upload className="w-3.5 h-3.5 inline mr-1" />}Remplacer
                </button>
                <button onClick={removeCover} className="text-xs font-medium text-red-500 hover:text-red-700 transition">
                  <Trash2 className="w-3.5 h-3.5 inline mr-1" />Retirer
                </button>
              </div>
            </div>
          ) : (
            <div onClick={() => fileRef.current?.click()} className="aspect-video rounded-md border border-dashed border-neutral-300 bg-neutral-50 flex flex-col items-center justify-center gap-1.5 cursor-pointer hover:border-neutral-400 transition">
              {uploading ? <Loader2 className="w-6 h-6 text-neutral-400 animate-spin" /> : (
                <>
                  <ImageIcon className="w-6 h-6 text-neutral-300" />
                  <span className="text-[11px] text-neutral-500">Téléverser une image</span>
                  <span className="text-[10px] text-neutral-400">max 5 Mo</span>
                </>
              )}
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadCover(f); e.target.value = ''; }} />
        </div>
      )}

      {/* Colors */}
      <div className="py-4 border-t border-neutral-200">
        <span className="text-xs font-medium text-neutral-700 block mb-3">Couleurs</span>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="label">Principale</label>
            <div className="flex items-center gap-2">
              <input type="color" value={settings.primary_color || '#0f766e'} onChange={(e) => update({ primary_color: e.target.value })} className="w-8 h-8 rounded border border-neutral-200 cursor-pointer" />
              <input value={settings.primary_color || '#0f766e'} onChange={(e) => update({ primary_color: e.target.value })} className="input flex-1 font-mono text-xs" />
            </div>
          </div>
          <div>
            <label className="label">Secondaire</label>
            <div className="flex items-center gap-2">
              <input type="color" value={settings.secondary_color || '#0f172a'} onChange={(e) => update({ secondary_color: e.target.value })} className="w-8 h-8 rounded border border-neutral-200 cursor-pointer" />
              <input value={settings.secondary_color || '#0f172a'} onChange={(e) => update({ secondary_color: e.target.value })} className="input flex-1 font-mono text-xs" />
            </div>
          </div>
        </div>
      </div>

      {/* Density */}
      <div className="py-4 border-t border-neutral-200">
        <span className="text-xs font-medium text-neutral-700 block mb-3">Densité des cartes</span>
        <div className="flex gap-1.5">
          {(['compact', 'comfortable', 'spacious'] as const).map((d) => (
            <button key={d} onClick={() => update({ card_density: d })} className={`flex-1 py-2 rounded-md text-[11px] font-medium transition-all ${settings.card_density === d ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'}`}>
              {d === 'compact' ? 'Compacte' : d === 'comfortable' ? 'Confortable' : 'Spacieuse'}
            </button>
          ))}
        </div>
      </div>

      {/* Display toggles */}
      <div className="py-4 border-t border-neutral-200 divide-y divide-neutral-100">
        <SettingRow label="Afficher les références" desc="Référence interne et OEM" active={settings.show_references} onToggle={() => update({ show_references: !settings.show_references })} />
        <SettingRow label="Afficher le stock" desc="Badges de disponibilité" active={settings.show_stock} onToggle={() => update({ show_stock: !settings.show_stock })} />
        <SettingRow label="Afficher les avantages" desc="Bandeau de réassurance" active={settings.show_perks} onToggle={() => update({ show_perks: !settings.show_perks })} />
      </div>

      {/* Low stock threshold */}
      <div className="py-4 border-t border-neutral-200">
        <label className="label">Seuil stock faible: {settings.low_stock_threshold} unités</label>
        <input type="range" min={1} max={20} value={settings.low_stock_threshold} onChange={(e) => update({ low_stock_threshold: Number(e.target.value) })} className="w-full accent-neutral-900" />
      </div>

      {/* Commercial content */}
      <div className="py-4 border-t border-neutral-200 space-y-4">
        <span className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Contenu commercial</span>
        <div><label className="label">Titre de couverture</label><input value={settings.hero_title} onChange={(e) => update({ hero_title: e.target.value })} placeholder="Titre accrocheur" className="input" /></div>
        <div><label className="label">Sous-titre</label><input value={settings.hero_subtitle} onChange={(e) => update({ hero_subtitle: e.target.value })} placeholder="Description courte" className="input" /></div>
        <div><label className="label">Bouton d'action</label><input value={settings.hero_cta_label} onChange={(e) => update({ hero_cta_label: e.target.value })} placeholder="Découvrir les produits" className="input" /></div>
      </div>

      {/* Promo banner */}
      <div className="py-4 border-t border-neutral-200 space-y-3">
        <SettingRow label="Bandeau promotionnel" desc="Bandeau défilant en haut" active={settings.promo_banner_active} onToggle={() => update({ promo_banner_active: !settings.promo_banner_active })} />
        {settings.promo_banner_active && (
          <div className="space-y-3 pt-2">
            <div><label className="label">Texte</label><input value={settings.promo_banner_text} onChange={(e) => update({ promo_banner_text: e.target.value })} placeholder="Ex: Livraison gratuite dès 50 000 FCFA" className="input" /></div>
            <div>
              <label className="label">Couleur</label>
              <div className="flex items-center gap-2">
                <input type="color" value={settings.promo_banner_color} onChange={(e) => update({ promo_banner_color: e.target.value })} className="w-8 h-8 rounded border border-neutral-200 cursor-pointer" />
                <input value={settings.promo_banner_color} onChange={(e) => update({ promo_banner_color: e.target.value })} className="input flex-1 font-mono text-xs" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Social links */}
      <div className="py-4 border-t border-neutral-200 space-y-3">
        <span className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Réseaux sociaux</span>
        {(['facebook', 'instagram', 'tiktok'] as const).map(network => (
          <div key={network}><label className="label capitalize">{network}</label><input value={(settings.social_links || {})[network] || ''} onChange={(e) => update({ social_links: { ...settings.social_links, [network]: e.target.value } })} placeholder={`URL ${network}`} className="input" /></div>
        ))}
      </div>

      {/* Badge */}
      <div className="py-4 border-t border-neutral-200">
        <SettingRow label="Badge Waarwi" desc="Pied de page" active={settings.show_waarwi_badge} onToggle={() => update({ show_waarwi_badge: !settings.show_waarwi_badge })} />
      </div>

      {/* Actions */}
      <div className="flex justify-between items-center pt-4 border-t border-neutral-200">
        <button onClick={resetDefaults} className="text-[11px] font-medium text-neutral-500 hover:text-neutral-900 transition flex items-center gap-1">
          <RotateCcw className="w-3 h-3" />Réinitialiser
        </button>
        <button onClick={saveAppearance} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 bg-neutral-900 text-white text-xs font-medium rounded-md hover:bg-neutral-800 transition active:scale-[0.97] disabled:opacity-50">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Enregistrer
        </button>
      </div>
    </div>
  );
}

function SettingRow({ label, desc, active, onToggle }: { label: string; desc: string; active: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="min-w-0">
        <div className="text-xs font-medium text-neutral-800">{label}</div>
        <div className="text-[10px] text-neutral-500">{desc}</div>
      </div>
      <button onClick={onToggle} className="shrink-0 relative ml-3">
        <div className={`w-9 h-5 rounded-full transition-colors relative ${active ? 'bg-neutral-900' : 'bg-neutral-200'}`}>
          <div className={`absolute top-0.5 bg-white rounded-full h-4 w-4 transition-transform shadow-sm ${active ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
        </div>
      </button>
    </div>
  );
}
