import { useState } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { Modal } from './Modal';

export function QuickCreateArticleModal({ open, onClose, onCreated, initialName }: {
  open: boolean;
  onClose: () => void;
  onCreated: (article: any) => void;
  initialName?: string;
}) {
  const { tenant, currentSite } = useApp();
  const { success, error } = useToast();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(initialName || '');
  const [salePrice, setSalePrice] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [ref, setRef] = useState('');
  const [stockInit, setStockInit] = useState('');

  const handleSave = async () => {
    if (!tenant || !name.trim() || !salePrice) { error('Nom et prix de vente requis'); return; }
    setSaving(true);
    const { data, error: err } = await supabase.from('articles').insert({
      tenant_id: tenant.id,
      site_id: currentSite?.id || null,
      name: name.trim(),
      sale_price: Number(salePrice),
      purchase_price: Number(purchasePrice) || 0,
      internal_ref: ref.trim() || `ART-${Date.now().toString(36).toUpperCase()}`,
      is_active: true,
      stock_min: 0,
      stock_max: 0,
      vat_rate: 0,
      min_price: 0,
      wholesale_price: 0,
      description: '',
      brand: '',
      oem_ref: '',
      supplier_ref: '',
      barcode: '',
      condition: 'new',
      unit: 'pce',
      location: '',
      image_url: '',
    }).select().single();
    if (err) { setSaving(false); error(err.message); return; }

    if (data && stockInit && Number(stockInit) > 0 && currentSite) {
      await supabase.rpc('adjust_stock', {
        p_article_id: data.id,
        p_site_id: currentSite.id,
        p_quantity: Number(stockInit),
        p_movement_type: 'initial',
        p_note: 'Stock initial',
      });
    }

    setSaving(false);
    success('Article créé');
    onCreated(data);
    setName(''); setSalePrice(''); setPurchasePrice(''); setRef(''); setStockInit('');
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Créer un article" size="sm" layer="top"
      footer={
        <button onClick={handleSave} disabled={saving || !name.trim() || !salePrice}
          className="btn-primary text-sm px-5 py-2.5 disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Enregistrer'}
        </button>
      }>
      <div className="space-y-3">
        <div>
          <label className="label">Désignation *</label>
          <input value={name} onChange={e => setName(e.target.value)} className="input" placeholder="Nom de l'article" autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Prix de vente *</label>
            <input type="number" value={salePrice} onChange={e => setSalePrice(e.target.value)} className="input" placeholder="0" />
          </div>
          <div>
            <label className="label">Prix d'achat</label>
            <input type="number" value={purchasePrice} onChange={e => setPurchasePrice(e.target.value)} className="input" placeholder="0" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Référence interne</label>
            <input value={ref} onChange={e => setRef(e.target.value)} className="input" placeholder="Auto-générée" />
          </div>
          <div>
            <label className="label">Stock initial</label>
            <input type="number" value={stockInit} onChange={e => setStockInit(e.target.value)} className="input" placeholder="0" min="0" />
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function QuickCreateCustomerModal({ open, onClose, onCreated, initialName }: {
  open: boolean;
  onClose: () => void;
  onCreated: (customer: any) => void;
  initialName?: string;
}) {
  const { tenant, currentSite } = useApp();
  const { success, error } = useToast();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(initialName || '');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');

  const handleSave = async () => {
    if (!tenant || !name.trim()) { error('Nom requis'); return; }
    setSaving(true);
    const { data, error: err } = await supabase.from('customers').insert({
      tenant_id: tenant.id,
      site_id: currentSite?.id || null,
      name: name.trim(),
      phone: phone.trim(),
      address: address.trim(),
      email: '',
      customer_type: 'individual',
      balance: 0,
      credit_limit: 0,
      is_active: true,
    }).select().single();
    setSaving(false);
    if (err) { error(err.message); return; }
    success('Client créé');
    onCreated(data);
    setName(''); setPhone(''); setAddress('');
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Créer un client" size="sm" layer="top"
      footer={
        <button onClick={handleSave} disabled={saving || !name.trim()}
          className="btn-primary text-sm px-5 py-2.5 disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Enregistrer'}
        </button>
      }>
      <div className="space-y-3">
        <div>
          <label className="label">Nom *</label>
          <input value={name} onChange={e => setName(e.target.value)} className="input" placeholder="Nom du client" autoFocus />
        </div>
        <div>
          <label className="label">Téléphone</label>
          <input value={phone} onChange={e => setPhone(e.target.value)} className="input" placeholder="77 000 00 00" />
        </div>
        <div>
          <label className="label">Adresse</label>
          <input value={address} onChange={e => setAddress(e.target.value)} className="input" placeholder="Adresse" />
        </div>
      </div>
    </Modal>
  );
}

export function QuickCreateButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onClick(); }}
      className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 transition-colors border-t border-slate-100"
    >
      <Plus className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}
