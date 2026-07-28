import { useEffect, useRef, useState } from 'react';
import { Loader2, Save, Upload, Trash2, Palette, Eye, EyeOff, RotateCcw, Check, Image as ImageIcon } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import type { ShopSettings } from '../../lib/shopTypes';
import { SHOP_THEMES } from '../../lib/shopThemes';

type Props = {
  settings: ShopSettings;
  onSettingsChange: (s: ShopSettings) => void;
};

const THEME_PREVIEWS: Record<string, { bg: string; accent: string; cardBorder: string }> = {
  premium_minimal: { bg: 'bg-gradient-to-br from-neutral-50 to-white', accent: 'text-slate-900', cardBorder: 'border-neutral-200' },
  marketplace: { bg: 'bg-gradient-to-br from-slate-800 to-slate-900', accent: 'text-white', cardBorder: 'border-neutral-700' },
  immersive: { bg: 'bg-gradient-to-br from-slate-900 via-slate-800 to-brand-800', accent: 'text-white', cardBorder: 'border-neutral-700' },
};

export function ShopAppearanceSettings({ settings, onSettingsChange }: Props) {
  const { tenant } = useApp();
  const { success, error } = useToast();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [focalDragging, setFocalDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const focalRef = useRef<HTMLDivElement>(null);

  // Global listeners to end focal dragging
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

  // Convert image to WebP and upload
  const uploadCover = async (file: File) => {
    if (!tenant) return;
    if (file.size > 5 * 1024 * 1024) {
      error('Image max 5 Mo');
      return;
    }
    setUploading(true);
    try {
      // Convert to WebP via canvas
      const img = new Image();
      img.src = URL.createObjectURL(file);
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const maxW = 1920;
      const maxH = 800;
      let w = img.width;
      let h = img.height;
      if (w > maxW) {
        h = (h * maxW) / w;
        w = maxW;
      }
      if (h > maxH) {
        w = (w * maxH) / h;
        h = maxH;
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas non supporté');
      ctx.drawImage(img, 0, 0, w, h);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/webp', 0.82),
      );
      if (!blob) throw new Error('Conversion WebP échouée');

      const path = `${tenant.id}/covers/cover-${Date.now()}.webp`;
      const { error: upErr } = await supabase.storage
        .from('tenant-logos')
        .upload(path, blob, { upsert: true, contentType: 'image/webp', cacheControl: '3600' });
      if (upErr) throw upErr;

      const { data: urlData } = supabase.storage
        .from('tenant-logos')
        .getPublicUrl(path);

      update({ cover_image_url: urlData.publicUrl });
      success('Image de couverture mise à jour (WebP)');
    } catch (e: any) {
      error(e.message || 'Erreur lors de l\'upload');
    } finally {
      setUploading(false);
      URL.revokeObjectURL(file.name);
    }
  };

  const removeCover = () => {
    update({
      cover_image_url: '',
      cover_image_alt: '',
      cover_focal_x: 50,
      cover_focal_y: 50,
    });
    success('Image de couverture retirée');
  };

  // Focal point drag handling
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
    success('Apparence réinitialisée aux valeurs par défaut');
  };

  return (
    <div className="card p-4 space-y-5">
      <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
        <div className="w-1 h-4 rounded-full bg-brand-500" />
        <Palette className="w-3.5 h-3.5 text-brand-600" />
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Apparence</span>
      </div>

      {/* Theme selector */}
      <div>
        <div className="text-xs font-bold text-slate-700 mb-2">Choisir un thème</div>
        <div className="grid grid-cols-3 gap-2.5">
          {Object.values(SHOP_THEMES).map((t) => {
            const preview = THEME_PREVIEWS[t.id];
            const selected = settings.theme === t.id;
            return (
              <button
                key={t.id}
                onClick={() => update({ theme: t.id })}
                className={`relative rounded-xl overflow-hidden border-2 transition-all ${selected ? 'border-brand-600 shadow-glow ring-2 ring-brand-500/20' : 'border-slate-200 hover:border-slate-300'}`}
              >
                {/* Mini preview */}
                <div className={`aspect-video ${preview.bg} flex flex-col items-center justify-center gap-1`}>
                  <div className={`w-8 h-1.5 rounded-full ${preview.accent === 'text-white' ? 'bg-white/80' : 'bg-slate-800'} opacity-80`} />
                  <div className="flex gap-0.5">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className={`w-3 h-3 rounded-sm ${preview.accent === 'text-white' ? 'bg-white/30' : 'bg-slate-200'}`}
                      />
                    ))}
                  </div>
                </div>
                <div className={`p-2 text-center ${selected ? 'bg-brand-50' : 'bg-white'}`}>
                  <div className={`text-[10px] font-bold ${selected ? 'text-brand-700' : 'text-slate-600'}`}>{t.label}</div>
                </div>
                {selected && (
                  <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-brand-600 flex items-center justify-center">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
        <div className="text-[10px] text-slate-400 mt-1.5">
          {SHOP_THEMES[settings.theme]?.description}
        </div>
      </div>

      {/* Cover image (only for immersive theme) */}
      {settings.theme === 'immersive' && (
        <div className="space-y-3">
          <div className="text-xs font-bold text-slate-700">Image de couverture</div>
          {settings.cover_image_url ? (
            <div className="space-y-2.5">
              {/* Focal point picker */}
              <div
                ref={focalRef}
                className="relative aspect-video rounded-xl overflow-hidden bg-slate-900 cursor-crosshair select-none"
                onMouseDown={startFocalDrag}
                onTouchStart={startFocalDrag}
                onMouseMove={(e) => focalDragging && handleFocalDrag(e)}
                onTouchMove={(e) => focalDragging && handleFocalDrag(e)}
              >
                <img
                  src={settings.cover_image_url}
                  alt={settings.cover_image_alt || 'Cover'}
                  className="absolute inset-0 w-full h-full object-cover"
                  style={{
                    objectPosition: `${settings.cover_focal_x}% ${settings.cover_focal_y}%`,
                    transform: 'scale(1.5)',
                  }}
                  draggable={false}
                />
                {/* Focal point indicator */}
                <div
                  className="absolute w-6 h-6 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                  style={{
                    left: `${settings.cover_focal_x}%`,
                    top: `${settings.cover_focal_y}%`,
                  }}
                >
                  <div className="w-6 h-6 rounded-full border-2 border-white shadow-lg flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-white" />
                  </div>
                </div>
                <div className="absolute bottom-1.5 left-1.5 px-2 py-0.5 rounded-md bg-black/50 text-white text-[9px] font-semibold backdrop-blur-sm">
                  Glissez pour ajuster le point focal
                </div>
              </div>

              {/* Overlay controls */}
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="label">Voile</label>
                  <div className="flex gap-1">
                    {(['dark', 'light', 'none'] as const).map((o) => (
                      <button
                        key={o}
                        onClick={() => update({ cover_overlay: o })}
                        className={`flex-1 h-8 rounded-lg text-[10px] font-bold transition-all ${settings.cover_overlay === o ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                      >
                        {o === 'dark' ? 'Sombre' : o === 'light' ? 'Clair' : 'Aucun'}
                      </button>
                    ))}
                  </div>
                </div>
                {settings.cover_overlay !== 'none' && (
                  <div>
                    <label className="label">Intensité: {settings.cover_overlay_intensity}%</label>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={settings.cover_overlay_intensity}
                      onChange={(e) => update({ cover_overlay_intensity: Number(e.target.value) })}
                      className="w-full accent-brand-600 h-8"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="label">Texte alternatif</label>
                <input
                  value={settings.cover_image_alt}
                  onChange={(e) => update({ cover_image_alt: e.target.value })}
                  className="input"
                  placeholder="Description de l'image (accessibilité)"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-xs font-bold hover:bg-slate-200 transition-colors"
                >
                  {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  Remplacer
                </button>
                <button
                  onClick={removeCover}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-50 text-red-600 text-xs font-bold hover:bg-red-100 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Retirer
                </button>
              </div>
            </div>
          ) : (
            <div
              onClick={() => fileRef.current?.click()}
              className="aspect-video rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-brand-400 hover:bg-brand-50/30 transition-all"
            >
              {uploading ? (
                <Loader2 className="w-8 h-8 text-brand-600 animate-spin" />
              ) : (
                <>
                  <ImageIcon className="w-8 h-8 text-slate-300" />
                  <div className="text-xs font-semibold text-slate-500">Téléverser une image</div>
                  <div className="text-[10px] text-slate-400">WebP auto · max 5 Mo · 1920×800 recommandé</div>
                </>
              )}
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadCover(f);
              e.target.value = '';
            }}
          />
        </div>
      )}

      {/* Colors */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Couleur principale</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={settings.primary_color || '#0f766e'}
              onChange={(e) => update({ primary_color: e.target.value })}
              className="w-10 h-10 rounded-lg border border-slate-200 cursor-pointer"
            />
            <input
              value={settings.primary_color || '#0f766e'}
              onChange={(e) => update({ primary_color: e.target.value })}
              className="input flex-1 font-mono text-xs"
            />
          </div>
        </div>
        <div>
          <label className="label">Couleur secondaire</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={settings.secondary_color || '#0f172a'}
              onChange={(e) => update({ secondary_color: e.target.value })}
              className="w-10 h-10 rounded-lg border border-slate-200 cursor-pointer"
            />
            <input
              value={settings.secondary_color || '#0f172a'}
              onChange={(e) => update({ secondary_color: e.target.value })}
              className="input flex-1 font-mono text-xs"
            />
          </div>
        </div>
      </div>

      {/* Card density */}
      <div>
        <label className="label">Densité des cartes</label>
        <div className="flex gap-1.5">
          {(['compact', 'comfortable', 'spacious'] as const).map((d) => (
            <button
              key={d}
              onClick={() => update({ card_density: d })}
              className={`flex-1 h-9 rounded-lg text-xs font-bold transition-all ${settings.card_density === d ? 'bg-brand-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {d === 'compact' ? 'Compacte' : d === 'comfortable' ? 'Confortable' : 'Spacieuse'}
            </button>
          ))}
        </div>
      </div>

      {/* Display toggles */}
      <div className="space-y-2">
        <AppearanceToggle
          icon={settings.show_references ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          label="Afficher les références"
          desc="Référence interne et OEM sur les cartes produit"
          active={settings.show_references}
          onToggle={() => update({ show_references: !settings.show_references })}
        />
        <AppearanceToggle
          icon={settings.show_stock ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          label="Afficher le stock"
          desc="Badges de disponibilité sur les cartes produit"
          active={settings.show_stock}
          onToggle={() => update({ show_stock: !settings.show_stock })}
        />
        <AppearanceToggle
          icon={settings.show_perks ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          label="Afficher les avantages"
          desc="Bandeau de réassurance (garantie, livraison, etc.)"
          active={settings.show_perks}
          onToggle={() => update({ show_perks: !settings.show_perks })}
        />
      </div>

      {/* Low stock threshold */}
      <div>
        <label className="label">Seuil de stock faible: {settings.low_stock_threshold} unités</label>
        <input
          type="range"
          min={1}
          max={20}
          value={settings.low_stock_threshold}
          onChange={(e) => update({ low_stock_threshold: Number(e.target.value) })}
          className="w-full accent-brand-600"
        />
      </div>

      {/* Commercial content */}
      <div className="space-y-4 pt-3 border-t border-slate-100">
        <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Contenu commercial</h4>
        <div>
          <label className="label">Titre de couverture</label>
          <input
            type="text"
            value={settings.hero_title}
            onChange={(e) => update({ hero_title: e.target.value })}
            placeholder="Titre accrocheur pour votre boutique"
            className="input"
          />
        </div>
        <div>
          <label className="label">Sous-titre</label>
          <input
            type="text"
            value={settings.hero_subtitle}
            onChange={(e) => update({ hero_subtitle: e.target.value })}
            placeholder="Description courte ou slogan"
            className="input"
          />
        </div>
        <div>
          <label className="label">Texte du bouton d'action</label>
          <input
            type="text"
            value={settings.hero_cta_label}
            onChange={(e) => update({ hero_cta_label: e.target.value })}
            placeholder="Découvrir les produits"
            className="input"
          />
        </div>
      </div>

      {/* Promo banner */}
      <div className="space-y-4 pt-3 border-t border-slate-100">
        <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Bandeau promotionnel</h4>
        <AppearanceToggle
          icon={settings.promo_banner_active ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          label="Activer le bandeau"
          desc="Bandeau défilant en haut de la boutique"
          active={settings.promo_banner_active}
          onToggle={() => update({ promo_banner_active: !settings.promo_banner_active })}
        />
        {settings.promo_banner_active && (
          <>
            <div>
              <label className="label">Texte du bandeau</label>
              <input
                type="text"
                value={settings.promo_banner_text}
                onChange={(e) => update({ promo_banner_text: e.target.value })}
                placeholder="Ex: Livraison gratuite dès 50 000 FCFA !"
                className="input"
              />
            </div>
            <div>
              <label className="label">Couleur du bandeau</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={settings.promo_banner_color}
                  onChange={(e) => update({ promo_banner_color: e.target.value })}
                  className="w-10 h-10 rounded-lg border border-slate-200 cursor-pointer"
                />
                <input
                  type="text"
                  value={settings.promo_banner_color}
                  onChange={(e) => update({ promo_banner_color: e.target.value })}
                  className="input flex-1"
                />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Social links */}
      <div className="space-y-4 pt-3 border-t border-slate-100">
        <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Réseaux sociaux</h4>
        {(['facebook', 'instagram', 'tiktok'] as const).map(network => (
          <div key={network}>
            <label className="label capitalize">{network}</label>
            <input
              type="url"
              value={(settings.social_links || {})[network] || ''}
              onChange={(e) => update({ social_links: { ...settings.social_links, [network]: e.target.value } })}
              placeholder={`URL de votre page ${network}`}
              className="input"
            />
          </div>
        ))}
      </div>

      {/* Waarwi badge */}
      <div className="pt-3 border-t border-slate-100">
        <AppearanceToggle
          icon={settings.show_waarwi_badge ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          label="Afficher le badge Waarwi"
          desc="Bloc 'Propulsé par Waarwi' dans le pied de page"
          active={settings.show_waarwi_badge}
          onToggle={() => update({ show_waarwi_badge: !settings.show_waarwi_badge })}
        />
      </div>

      {/* Actions */}
      <div className="flex justify-between items-center pt-2 border-t border-slate-100">
        <button
          onClick={resetDefaults}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-slate-500 text-xs font-semibold hover:bg-slate-100 transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Réinitialiser
        </button>
        <button
          onClick={saveAppearance}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-700 text-white text-xs font-bold shadow-glow hover:shadow-premium active:scale-95 transition-all disabled:opacity-60"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Enregistrer l'apparence
        </button>
      </div>
    </div>
  );
}

function AppearanceToggle({
  icon,
  label,
  desc,
  active,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  desc: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50/80 border border-slate-200/80">
      <div className="flex items-center gap-2 flex-1 min-w-0 mr-2">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${active ? 'bg-brand-100 text-brand-700' : 'bg-slate-200 text-slate-400'}`}>
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-xs font-semibold text-slate-700 truncate">{label}</div>
          <div className="text-[10px] text-slate-500 truncate">{desc}</div>
        </div>
      </div>
      <button
        onClick={onToggle}
        className={`shrink-0 w-9 h-5 rounded-full transition-colors relative ${active ? 'bg-brand-600' : 'bg-slate-300'}`}
      >
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all ${active ? 'left-4.5' : 'left-0.5'}`} style={{ left: active ? '18px' : '2px' }} />
      </button>
    </div>
  );
}
