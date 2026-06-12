import { useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, Plus, Minus, Loader2, AlertTriangle, ArrowRightLeft, ClipboardList, ArrowDownCircle, ArrowUpCircle, X, MapPin, TrendingDown, History, Calendar, BookOpen, PackageOpen, Clock, LayoutGrid, List, Check, Save } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { usePermissions } from '../lib/permissions';
import { useToast } from '../context/ToastContext';
import { formatFCFA, formatDateTime } from '../lib/format';
import { Modal } from '../components/Modal';
import { EmptyState } from '../components/EmptyState';
import { SearchableSelect } from '../components/SearchableSelect';
import { desktopAutoFocus } from '../lib/device';
import { PremiumDateRangePicker } from '../components/PremiumDateRangePicker';
import { consumeNavContext } from '../lib/navHighlight';
import { LotPickerModal, type ArticleLotSelection } from '../components/LotPickerModal';

type Row = {
  article_id: string;
  name: string;
  internal_ref: string;
  purchase_price: number;
  stock_min: number;
  stock_max: number;
  quantity: number;
  location: string;
};

type AdjustMode = 'in' | 'out' | 'transfer' | 'inventory';
type FilterKey = 'all' | 'low' | 'out';
type StockMethod = 'none' | 'cmup' | 'lot';

type LotRow = {
  id: string;
  article_id: string;
  article_name: string;
  article_ref: string;
  batch_number: string;
  expiry_date: string | null;
  remaining_quantity: number;
  initial_quantity: number;
  purchase_price: number;
  received_at: string;
};

export function Stock() {
  const { tenant, currentSite, sites, dataTick } = useApp();
  const { can } = usePermissions();
  const { success, error } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [tab, setTab] = useState<'stocks' | 'movements' | 'lots'>('stocks');
  const [moves, setMoves] = useState<any[]>([]);
  const [mvDateFrom, setMvDateFrom] = useState<string>('');
  const [mvDateTo, setMvDateTo] = useState<string>('');
  const [mvPickerOpen, setMvPickerOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards');
  const [listEditMode, setListEditMode] = useState<'in' | 'out' | 'inventory'>('in');
  type ListEditEntry = { article_id: string; qty: number | ''; note: string; lot_number: string; };
  const [listEdits, setListEdits] = useState<Map<string, ListEditEntry>>(new Map());
  const [listSaving, setListSaving] = useState(false);
  const listInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  const [adjOpen, setAdjOpen] = useState(false);
  const [adjRow, setAdjRow] = useState<Row | null>(null);
  const [adjMode, setAdjMode] = useState<AdjustMode>('in');
  const [adjQty, setAdjQty] = useState<number | ''>('');
  const [adjNote, setAdjNote] = useState('');
  const [adjTargetSite, setAdjTargetSite] = useState('');
  const [adjInventoryQty, setAdjInventoryQty] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);

  // Lot-specific fields
  const [adjBatchNumber, setAdjBatchNumber] = useState('');
  const [adjExpiryDate, setAdjExpiryDate] = useState('');
  const [adjPurchasePrice, setAdjPurchasePrice] = useState<number | ''>('');
  const [lots, setLots] = useState<LotRow[]>([]);

  const stockMethod: StockMethod = ((tenant as any)?.settings?.stock_method as StockMethod) || 'none';
  const sharedArticles = (tenant as any)?.settings?.shared_articles !== false;
  const canTransfer = sites.length > 1 && sharedArticles;

  // Lot picker for sortie
  const [lotPickerOutOpen, setLotPickerOutOpen] = useState(false);
  const [lotPickerOutRow, setLotPickerOutRow] = useState<Row | null>(null);
  const [lotPickerOutQty, setLotPickerOutQty] = useState(0);

  const load = async (silent = false) => {
    if (!tenant || !currentSite) return;
    if (!silent) setLoading(true);

    // Fetch all articles in batches (Supabase default limit is 1000)
    let allArts: any[] = [];
    let from = 0;
    const batchSize = 1000;
    while (true) {
      let query = supabase
        .from('articles')
        .select('id, name, internal_ref, purchase_price, stock_min, stock_max, location')
        .eq('tenant_id', tenant.id)
        .eq('is_active', true)
        .range(from, from + batchSize - 1);
      if (!sharedArticles && currentSite) {
        query = query.or(`site_id.eq.${currentSite.id},site_id.is.null`);
      }
      const { data, error: e } = await query;
      if (e || !data) break;
      allArts = allArts.concat(data);
      if (data.length < batchSize) break;
      from += batchSize;
    }

    const [{ data: stk }, { data: mv }] = await Promise.all([
      supabase.from('stock_levels').select('article_id, quantity').eq('tenant_id', tenant.id).eq('site_id', currentSite.id),
      supabase.from('stock_movements')
        .select('id, movement_type, quantity, previous_qty, new_qty, note, created_at, article_id, articles(name, internal_ref)')
        .eq('tenant_id', tenant.id).eq('site_id', currentSite.id)
        .order('created_at', { ascending: false }).limit(150),
    ]);
    const qmap = new Map((stk || []).map((r: any) => [r.article_id, Number(r.quantity)]));
    setRows(allArts.map((a: any) => ({
      article_id: a.id, name: a.name, internal_ref: a.internal_ref,
      purchase_price: Number(a.purchase_price), stock_min: Number(a.stock_min),
      stock_max: Number(a.stock_max), quantity: qmap.get(a.id) ?? 0, location: a.location || '',
    })).sort((a, b) => a.name.localeCompare(b.name)));
    setMoves(mv || []);

    // Load lots if lot mode
    if (stockMethod === 'lot') {
      const { data: lotData } = await supabase
        .from('stock_lots')
        .select('id, article_id, batch_number, expiry_date, remaining_quantity, initial_quantity, purchase_price, received_at, articles(name, internal_ref)')
        .eq('tenant_id', tenant.id)
        .eq('site_id', currentSite.id)
        .gt('remaining_quantity', 0)
        .order('expiry_date', { ascending: true });
      setLots((lotData || []).map((l: any) => ({
        id: l.id, article_id: l.article_id,
        article_name: l.articles?.name || '', article_ref: l.articles?.internal_ref || '',
        batch_number: l.batch_number, expiry_date: l.expiry_date,
        remaining_quantity: Number(l.remaining_quantity), initial_quantity: Number(l.initial_quantity),
        purchase_price: Number(l.purchase_price), received_at: l.received_at,
      })));
    }

    if (!silent) setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenant?.id, currentSite?.id]);

  const [flashKey, setFlashKey] = useState<string | null>(null);
  useEffect(() => {
    const ctx = consumeNavContext();
    if (!ctx?.target) return;
    if (ctx.target === 'outOfStock') { setTab('stocks'); setFilter('out'); setFlashKey('out'); }
    else if (ctx.target === 'lowStock') { setTab('stocks'); setFilter('low'); setFlashKey('low'); }
    else if (ctx.target === 'stockIn') { setTab('movements'); setFlashKey('stockIn'); }
    else if (ctx.target === 'articles') { setTab('stocks'); setFilter('all'); setFlashKey('articles'); }
    const t = setTimeout(() => setFlashKey(null), 6800);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => { if (dataTick > 0) load(true); /* eslint-disable-next-line */ }, [dataTick]);

  const lowCount = useMemo(() => rows.filter(r => r.quantity <= r.stock_min && r.quantity > 0).length, [rows]);
  const outCount = useMemo(() => rows.filter(r => r.quantity <= 0).length, [rows]);
  const okCount = rows.length - lowCount - outCount;
  const totalValue = useMemo(() => rows.reduce((s, r) => s + r.quantity * r.purchase_price, 0), [rows]);

  const filteredMoves = useMemo(() => {
    if (!mvDateFrom && !mvDateTo) return moves;
    const f = mvDateFrom ? new Date(mvDateFrom) : null;
    if (f) f.setHours(0, 0, 0, 0);
    const t = mvDateTo ? new Date(mvDateTo) : null;
    if (t) t.setHours(23, 59, 59, 999);
    return moves.filter(m => {
      const d = new Date(m.created_at);
      if (f && d < f) return false;
      if (t && d > t) return false;
      return true;
    });
  }, [moves, mvDateFrom, mvDateTo]);

  const printInventoryBook = () => {
    const w = window.open('', '_blank', 'width=900,height=1200');
    if (!w) return;
    const avail = [...rows].filter(r => r.quantity > 0).sort((a, b) => a.name.localeCompare(b.name));
    const totalQty = avail.reduce((s, r) => s + r.quantity, 0);
    const totalValue = avail.reduce((s, r) => s + r.quantity * r.purchase_price, 0);
    const now = new Date();
    const nowStr = now.toLocaleString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const ref = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR') + ' FCFA';
    const escapeHtml = (s: string) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
    const rowsHtml = avail.map((r, i) => `
      <tr>
        <td class="c-num">${i + 1}</td>
        <td class="c-ref">${escapeHtml(r.internal_ref)}</td>
        <td class="c-name">${escapeHtml(r.name)}</td>
        <td class="c-loc">${escapeHtml(r.location || '')}</td>
        <td class="c-qty">${r.quantity}</td>
        <td class="c-unit">${fmt(r.purchase_price)}</td>
        <td class="c-val">${fmt(r.quantity * r.purchase_price)}</td>
      </tr>`).join('');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Livre d'inventaire — ${ref}</title>
<style>
  @page { size: A4; margin: 14mm 12mm 16mm 12mm; }
  @media print { * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #000000; font-size: 9.5pt; line-height: 1.4; background: #fff; }
  .doc { max-width: 186mm; margin: 0 auto; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2.5px solid #000000; padding-bottom: 8mm; margin-bottom: 6mm; }
  .head .brand { font-size: 15pt; font-weight: 900; letter-spacing: 0.5px; color: #000000; }
  .head .sub { font-size: 8.5pt; font-weight: 700; color: #000000; margin-top: 1mm; text-transform: uppercase; letter-spacing: 1.2px; }
  .head .meta { text-align: right; font-size: 8.5pt; font-weight: 600; color: #000000; }
  .head .meta .ref { font-family: 'Courier New', monospace; font-weight: 900; color: #000000; font-size: 10.5pt; }
  .title { text-align: center; font-size: 16pt; font-weight: 900; letter-spacing: 1px; text-transform: uppercase; margin: 0 0 2mm; color: #000000; }
  .title-sub { text-align: center; font-size: 9pt; font-weight: 700; color: #000000; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 7mm; }
  .info { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4mm; margin-bottom: 6mm; border: 1.5px solid #000000; border-radius: 2mm; padding: 3mm 4mm; background: #f5f5f5; }
  .info .cell .l { font-size: 7pt; font-weight: 800; color: #000000; text-transform: uppercase; letter-spacing: 1px; }
  .info .cell .v { font-size: 10.5pt; font-weight: 900; color: #000000; margin-top: 0.5mm; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  thead tr { background: #000000; color: #ffffff; }
  thead th { text-align: left; font-size: 8pt; padding: 2.5mm 2mm; font-weight: 800; text-transform: uppercase; letter-spacing: 0.8px; color: #ffffff; }
  thead th.right { text-align: right; }
  tbody tr { page-break-inside: avoid; border-bottom: 1px solid #000000; }
  tbody tr:nth-child(even) { background: #f5f5f5; }
  tbody td { padding: 2mm 2mm; font-size: 9pt; font-weight: 500; color: #000000; vertical-align: top; }
  .c-num { width: 10mm; font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; color: #000000; }
  .c-ref { width: 26mm; font-family: 'Courier New', monospace; font-size: 8.5pt; font-weight: 700; color: #000000; }
  .c-name { font-weight: 600; color: #000000; }
  .c-loc { width: 22mm; font-size: 8.5pt; font-weight: 600; color: #000000; }
  .c-qty { width: 14mm; text-align: right; font-weight: 900; font-variant-numeric: tabular-nums; color: #000000; }
  .c-unit { width: 28mm; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; color: #000000; }
  .c-val { width: 32mm; text-align: right; font-weight: 900; font-variant-numeric: tabular-nums; color: #000000; }
  tfoot tr { background: #000000; color: #ffffff; }
  tfoot td { padding: 3mm 2mm; font-size: 9.5pt; font-weight: 800; color: #ffffff; }
  tfoot .lbl { text-transform: uppercase; letter-spacing: 1.2px; font-size: 8.5pt; font-weight: 900; }
  .foot { margin-top: 10mm; display: flex; justify-content: space-between; align-items: flex-end; font-size: 8.5pt; font-weight: 600; color: #000000; border-top: 1.5px solid #000000; padding-top: 4mm; }
  .sig { width: 55mm; text-align: center; }
  .sig .line { height: 14mm; border-bottom: 1.5px solid #000000; }
  .sig .cap { margin-top: 1.5mm; text-transform: uppercase; letter-spacing: 1px; font-size: 7.5pt; font-weight: 800; color: #000000; }
  .pagenum::after { content: "Page " counter(page); }
  .waarwi { margin-top: 8mm; padding-top: 3mm; border-top: 1px dashed #000000; text-align: center; font-size: 9px; font-weight: 600; color: #000000; letter-spacing: 0.3px; }
</style>
</head><body>
<div class="doc">
  <div class="head">
    <div>
      <div class="brand">${escapeHtml(tenant?.name || 'Entreprise')}</div>
      <div class="sub">${escapeHtml(currentSite?.name || '')}</div>
    </div>
    <div class="meta">
      <div class="ref">N° ${ref}</div>
      <div>Émis le ${nowStr}</div>
    </div>
  </div>

  <div class="title">Livre d'inventaire</div>
  <div class="title-sub">État du stock disponible</div>

  <div class="info">
    <div class="cell"><div class="l">Site</div><div class="v">${escapeHtml(currentSite?.name || '—')}</div></div>
    <div class="cell"><div class="l">Références</div><div class="v">${avail.length}</div></div>
    <div class="cell"><div class="l">Quantité totale</div><div class="v">${totalQty.toLocaleString('fr-FR')}</div></div>
    <div class="cell"><div class="l">Valeur d'achat</div><div class="v">${fmt(totalValue)}</div></div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="right">#</th>
        <th>Référence</th>
        <th>Désignation</th>
        <th>Emplacement</th>
        <th class="right">Qté</th>
        <th class="right">P.U. Achat</th>
        <th class="right">Valeur</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml || '<tr><td colspan="7" style="padding:10mm;text-align:center;font-weight:600;color:#000000;">Aucun article disponible en stock.</td></tr>'}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="4" class="lbl">Total général</td>
        <td style="text-align:right;">${totalQty.toLocaleString('fr-FR')}</td>
        <td></td>
        <td style="text-align:right;">${fmt(totalValue)}</td>
      </tr>
    </tfoot>
  </table>

  <div class="foot">
    <div class="sig"><div class="line"></div><div class="cap">Magasinier</div></div>
    <div class="sig"><div class="line"></div><div class="cap">Responsable</div></div>
    <div style="text-align:right;">
      <div class="pagenum"></div>
      <div style="margin-top:1mm;">Document généré automatiquement</div>
    </div>
  </div>
  <div class="waarwi">Propulsée par <strong>WAARWI</strong> — Plateforme Business 2.0 made in Sénégal</div>
</div>
</body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 400);
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return rows.filter(r => {
      if (filter === 'low' && !(r.quantity > 0 && r.quantity <= r.stock_min)) return false;
      if (filter === 'out' && r.quantity > 0) return false;
      if (!q) return true;
      return r.name.toLowerCase().includes(q) || r.internal_ref.toLowerCase().includes(q) || (r.location || '').toLowerCase().includes(q);
    });
  }, [rows, search, filter]);

  const openAdj = (r: Row, mode: AdjustMode) => {
    setAdjRow(r); setAdjMode(mode); setAdjQty(''); setAdjNote('');
    setAdjTargetSite(sites.filter(s => s.id !== currentSite?.id)[0]?.id || '');
    setAdjInventoryQty(r.quantity);
    setAdjBatchNumber(''); setAdjExpiryDate(''); setAdjPurchasePrice(r.purchase_price || '');
    setAdjOpen(true);
  };

  const openAdjNew = (mode: AdjustMode) => {
    if (rows.length === 0) return;
    const first = rows[0];
    setAdjRow(first); setAdjMode(mode); setAdjQty(''); setAdjNote('');
    setAdjTargetSite(sites.filter(s => s.id !== currentSite?.id)[0]?.id || '');
    setAdjInventoryQty(first.quantity);
    setAdjBatchNumber(''); setAdjExpiryDate(''); setAdjPurchasePrice(first.purchase_price || '');
    setAdjOpen(true);
  };

  const saveAdj = async () => {
    if (!adjRow || !currentSite) return;
    const qty = Number(adjQty);
    setSaving(true);
    try {
      if (adjMode === 'inventory') {
        const realQty = Number(adjInventoryQty);
        const diff = realQty - adjRow.quantity;
        if (diff === 0) { setAdjOpen(false); setSaving(false); return; }
        const { error: e } = await supabase.rpc('adjust_stock', {
          p_article_id: adjRow.article_id, p_site_id: currentSite.id,
          p_quantity: diff, p_movement_type: 'inventory',
          p_note: adjNote || `Inventaire: ${adjRow.quantity} → ${realQty}`,
        });
        if (e) throw e;
        success('Inventaire enregistré');
      } else if (adjMode === 'transfer') {
        if (!adjTargetSite) { error('Choisissez un magasin de destination'); setSaving(false); return; }
        if (!qty || qty <= 0) { error('Quantité invalide'); setSaving(false); return; }
        const { error: e1 } = await supabase.rpc('adjust_stock', {
          p_article_id: adjRow.article_id, p_site_id: currentSite.id,
          p_quantity: -qty, p_movement_type: 'transfer_out', p_note: adjNote || 'Transfert sortie',
        });
        if (e1) throw e1;
        const { error: e2 } = await supabase.rpc('adjust_stock', {
          p_article_id: adjRow.article_id, p_site_id: adjTargetSite,
          p_quantity: qty, p_movement_type: 'transfer_in', p_note: adjNote || 'Transfert entrée',
        });
        if (e2) throw e2;
        success('Transfert effectué');
      } else if (adjMode === 'in' && stockMethod === 'lot') {
        // Lot mode: create a lot record
        if (!qty || qty <= 0) { error('Quantité invalide'); setSaving(false); return; }
        if (!adjBatchNumber.trim()) { error('Numéro de lot requis'); setSaving(false); return; }
        const { error: e } = await supabase.rpc('adjust_stock_lot', {
          p_article_id: adjRow.article_id, p_site_id: currentSite.id,
          p_quantity: qty, p_batch_number: adjBatchNumber.trim(),
          p_expiry_date: adjExpiryDate || null,
          p_purchase_price: Number(adjPurchasePrice) || adjRow.purchase_price,
          p_note: adjNote || `Lot ${adjBatchNumber.trim()}`,
        });
        if (e) throw e;
        success('Lot enregistré');
      } else if (adjMode === 'in' && stockMethod === 'cmup') {
        // CMUP mode: entry + recalculate average
        if (!qty || qty <= 0) { error('Quantité invalide'); setSaving(false); return; }
        const price = Number(adjPurchasePrice) || adjRow.purchase_price;
        // First do the stock adjustment
        const { error: e } = await supabase.rpc('adjust_stock', {
          p_article_id: adjRow.article_id, p_site_id: currentSite.id,
          p_quantity: qty, p_movement_type: 'adjustment_in',
          p_note: adjNote || 'Entrée stock (CMUP)',
        });
        if (e) throw e;
        // Recalculate CMUP
        const { error: e2 } = await supabase.rpc('recalculate_cmup', {
          p_article_id: adjRow.article_id, p_site_id: currentSite.id,
          p_new_quantity: qty, p_new_purchase_price: price,
        });
        if (e2) throw e2;
        success('Stock et CMUP mis à jour');
      } else if (adjMode === 'out' && stockMethod === 'lot') {
        // Lot mode sortie: open lot picker
        if (!qty || qty <= 0) { error('Quantité invalide'); setSaving(false); return; }
        setLotPickerOutRow(adjRow);
        setLotPickerOutQty(qty);
        setAdjOpen(false);
        setSaving(false);
        setLotPickerOutOpen(true);
        return;
      } else {
        if (!qty || qty <= 0) { error('Quantité invalide'); setSaving(false); return; }
        const signedQty = adjMode === 'in' ? qty : -qty;
        const type = adjMode === 'in' ? 'adjustment_in' : 'adjustment_out';
        const { error: e } = await supabase.rpc('adjust_stock', {
          p_article_id: adjRow.article_id, p_site_id: currentSite.id,
          p_quantity: signedQty, p_movement_type: type,
          p_note: adjNote || (adjMode === 'in' ? 'Entrée stock' : 'Sortie stock'),
        });
        if (e) throw e;
        success('Stock mis à jour');
      }
      setAdjOpen(false);
      await load();
    } catch (e: any) {
      error(e.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  const mvTypeLabel: Record<string, string> = {
    stock_initial: 'Initial', sale: 'Vente', adjustment_in: 'Entrée', adjustment_out: 'Sortie',
    initial: 'Initial', transfer_in: 'Transfert +', transfer_out: 'Transfert -',
    inventory: 'Inventaire', return: 'Retour', purchase: 'Achat',
  };
  const mvTypeColor: Record<string, string> = {
    stock_initial: 'bg-slate-100 text-slate-700', initial: 'bg-slate-100 text-slate-700',
    sale: 'bg-red-50 text-red-700', adjustment_out: 'bg-red-50 text-red-700', transfer_out: 'bg-amber-50 text-amber-700',
    adjustment_in: 'bg-emerald-50 text-emerald-700', transfer_in: 'bg-emerald-50 text-emerald-700',
    inventory: 'bg-blue-50 text-blue-700', purchase: 'bg-emerald-50 text-emerald-700', return: 'bg-slate-100 text-slate-700',
  };

  return (
    <div className="space-y-3 pb-6">
      {/* ── Unified premium header (title + search + filter) ────────── */}
      <div className="sticky top-0 z-10 -mx-3 sm:-mx-5 lg:-mx-8 px-3 sm:px-5 lg:px-8 pb-3 pt-3 sm:pt-4 lg:pt-6 -mt-3 sm:-mt-4 lg:-mt-6 bg-slate-50/95 backdrop-blur-sm space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 rounded-2xl bg-white border border-slate-200 shadow-sm hover:shadow-md focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-500/20 transition-all">
          <div className="flex items-center gap-2 pr-2 border-r border-slate-200 shrink-0">
            <div className="leading-tight">
              <h1 className="text-sm font-bold tracking-tight text-slate-900 leading-none">Stock</h1>
              <div className="text-[9px] font-semibold tracking-wider uppercase text-slate-400 leading-none mt-0.5 hidden sm:block">{currentSite?.name || 'Inventaire'}</div>
              <div className="text-[9px] font-semibold tracking-wider uppercase text-slate-400 leading-none mt-0.5 sm:hidden">Inventaire</div>
            </div>
          </div>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher…"
            className="flex-1 min-w-0 w-0 bg-transparent text-xs focus:outline-none placeholder:text-slate-400"
          />
          {search && (
            <button onClick={() => setSearch('')} className="shrink-0 p-1 text-slate-400 hover:text-slate-600 transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          {tab === 'movements' && (
            <button
              onClick={() => setMvPickerOpen(true)}
              className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold transition-all ${
                (mvDateFrom || mvDateTo)
                  ? 'bg-brand-50 text-brand-700 border border-brand-200'
                  : 'bg-slate-50 text-slate-500 border border-slate-200 hover:bg-slate-100'
              }`}
              title="Filtrer par période"
            >
              <Calendar className="w-3.5 h-3.5" />
              {(mvDateFrom || mvDateTo) ? (
                <span className="hidden md:inline num max-w-[140px] truncate">
                  {mvDateFrom ? new Date(mvDateFrom).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '…'}
                  {' → '}
                  {mvDateTo ? new Date(mvDateTo).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '…'}
                </span>
              ) : (
                <span className="hidden md:inline">Période</span>
              )}
            </button>
          )}
          {stockMethod === 'lot' && (
            <button
              onClick={() => setTab(t => t === 'lots' ? 'stocks' : 'lots')}
              className={`shrink-0 w-8 h-8 rounded-xl flex items-center justify-center active:scale-95 transition-all ${tab === 'lots' ? 'bg-orange-600 shadow-glow' : 'bg-white border border-slate-200 hover:border-orange-300'}`}
              aria-label="Voir les lots"
            >
              <PackageOpen className={`w-3.5 h-3.5 ${tab === 'lots' ? 'text-white' : 'text-orange-600'}`} />
            </button>
          )}
          {tab === 'stocks' && (
            <button
              onClick={() => { setViewMode(v => v === 'cards' ? 'list' : 'cards'); setListEdits(new Map()); }}
              className={`shrink-0 w-8 h-8 rounded-xl flex items-center justify-center active:scale-95 transition-all ${viewMode === 'list' ? 'bg-blue-600 shadow-glow' : 'bg-white border border-slate-200 hover:border-blue-300'}`}
              aria-label={viewMode === 'cards' ? 'Vue liste editable' : 'Vue cartes'}
            >
              {viewMode === 'cards' ? <List className="w-3.5 h-3.5 text-blue-600" /> : <LayoutGrid className="w-3.5 h-3.5 text-white" />}
            </button>
          )}
          <button
            onClick={() => setTab(t => t === 'stocks' ? 'movements' : 'stocks')}
            className={`shrink-0 w-8 h-8 rounded-xl flex items-center justify-center active:scale-95 transition-all ${tab === 'movements' ? 'shadow-glow' : 'shadow-glow hover:shadow-premium'}`}
            style={{ background: tab === 'movements' ? 'linear-gradient(135deg, #064e3b 0%, #0f766e 100%)' : 'linear-gradient(135deg, #0f766e 0%, #064e3b 100%)' }}
            aria-label={tab === 'stocks' ? 'Voir les mouvements' : 'Voir l\'inventaire'}
          >
            <History className="w-3.5 h-3.5 text-white" />
          </button>
        </div>
      </div>

      {/* Inline stats chips */}
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider overflow-x-auto no-scrollbar whitespace-nowrap">
        <span className="shrink-0 px-2 py-1 rounded-full bg-slate-100 text-slate-600 num">{filtered.length} / {rows.length}</span>
        <button
          onClick={() => setFilter('all')}
          className={`shrink-0 px-2 py-1 rounded-full inline-flex items-center gap-1 transition-all ${
            filter === 'all' ? 'bg-ink-900 text-white' : 'bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100'
          }`}
        >Tous</button>
        {okCount > 0 && (
          <span className="shrink-0 px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 inline-flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />{okCount} OK
          </span>
        )}
        <button
          onClick={() => setFilter(f => f === 'low' ? 'all' : 'low')}
          disabled={lowCount === 0}
          className={`shrink-0 px-2 py-1 rounded-full inline-flex items-center gap-1 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
            filter === 'low' ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
          }`}
        >
          <TrendingDown className="w-3 h-3" />{lowCount} seuil bas
        </button>
        <button
          onClick={() => setFilter(f => f === 'out' ? 'all' : 'out')}
          disabled={outCount === 0}
          className={`shrink-0 px-2 py-1 rounded-full inline-flex items-center gap-1 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
            filter === 'out' ? 'bg-red-500 text-white' : 'bg-red-50 text-red-700 hover:bg-red-100'
          }`}
        >
          <AlertTriangle className="w-3 h-3" />{outCount} rupture{outCount > 1 ? 's' : ''}
        </button>
        {can('view_purchase_prices') && <span className="shrink-0 px-2 py-1 rounded-full bg-slate-50 text-slate-600 border border-slate-200 num">Val. {formatFCFA(totalValue)}</span>}
      </div>

      {/* Quick actions row */}
      {can('manage_stock') && (
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar whitespace-nowrap">
          <button onClick={() => openAdjNew('in')} className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-white border border-slate-200 text-slate-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 transition-all active:scale-95">
            <ArrowDownCircle className="w-3.5 h-3.5 text-emerald-600" />Entrée
          </button>
          <button onClick={() => openAdjNew('out')} className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-white border border-slate-200 text-slate-700 hover:border-red-300 hover:bg-red-50 hover:text-red-700 transition-all active:scale-95">
            <ArrowUpCircle className="w-3.5 h-3.5 text-red-500" />Sortie
          </button>
          {canTransfer && (
            <button onClick={() => openAdjNew('transfer')} className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-white border border-slate-200 text-slate-700 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 transition-all active:scale-95">
              <ArrowRightLeft className="w-3.5 h-3.5 text-amber-600" />Transfert
            </button>
          )}
          <button onClick={() => openAdjNew('inventory')} className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-white border border-slate-200 text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 transition-all active:scale-95">
            <ClipboardList className="w-3.5 h-3.5 text-blue-600" />Inventaire
          </button>
          <button onClick={printInventoryBook} className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-gradient-to-br from-ink-900 to-slate-800 text-white hover:shadow-glow transition-all active:scale-95 ml-auto">
            <BookOpen className="w-3.5 h-3.5" />Livre d'inventaire
          </button>
        </div>
      )}
      </div>

      {tab === 'stocks' ? (
        loading ? (
          <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-brand-700" /></div>
        ) : filtered.length === 0 ? (
          <div className="card-premium"><EmptyState icon={Boxes} title="Aucun article" description="Créez des articles dans le module Articles." /></div>
        ) : viewMode === 'list' ? (
          <StockListEditView
            filtered={filtered}
            listEditMode={listEditMode}
            setListEditMode={setListEditMode}
            listEdits={listEdits}
            setListEdits={setListEdits}
            listSaving={listSaving}
            setListSaving={setListSaving}
            listInputRefs={listInputRefs}
            currentSite={currentSite}
            canViewPrices={can('view_purchase_prices')}
            onSaved={async () => { await load(); setListEdits(new Map()); }}
            successToast={success}
            errorToast={error}
            stockMethod={stockMethod}
          />
        ) : (
          <div className={`grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5 count-up ${flashKey === 'out' || flashKey === 'low' || flashKey === 'articles' ? 'waarwi-flash waarwi-flash-scroll' : ''}`}>
            {filtered.map(r => {
              const out = r.quantity <= 0;
              const low = !out && r.quantity <= r.stock_min;
              const value = r.quantity * r.purchase_price;
              const ratio = r.stock_max > 0 ? Math.min(100, Math.round((r.quantity / r.stock_max) * 100)) : 0;
              return (
                <div key={r.article_id} className="card-premium p-3 flex flex-col gap-2 hover:border-brand-400 transition-all duration-300 group">
                  <div className="flex items-start gap-2">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 ${
                      out ? 'bg-gradient-to-br from-red-400 to-red-600 text-white shadow-glow' :
                      low ? 'bg-gradient-to-br from-amber-400 to-amber-600 text-white' :
                      'bg-gradient-to-br from-brand-500 to-brand-700 text-white'
                    }`}>
                      <Boxes className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-semibold text-slate-900 leading-tight break-words">{r.name}</div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="font-mono text-[10px] text-slate-500 truncate">{r.internal_ref}</span>
                        {r.location && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-400 shrink-0">
                            <MapPin className="w-2.5 h-2.5" />{r.location}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full num ${
                      out ? 'bg-red-100 text-red-700' : low ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-700'
                    }`}>
                      {r.quantity}
                    </span>
                  </div>

                  {/* stock bar */}
                  <div className="relative h-1 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${
                        out ? 'bg-gradient-to-r from-red-400 to-red-500' :
                        low ? 'bg-gradient-to-r from-amber-400 to-amber-500' :
                        'bg-gradient-to-r from-emerald-400 to-emerald-500'
                      }`}
                      style={{ width: `${Math.max(out ? 0 : 4, ratio)}%` }}
                    />
                  </div>

                  <div className={`grid gap-1.5 pt-1.5 border-t border-slate-100 ${can('view_purchase_prices') ? 'grid-cols-3' : 'grid-cols-2'}`}>
                    <div>
                      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Min</div>
                      <div className="text-[11px] font-bold text-slate-700 num leading-tight mt-0.5">{r.stock_min}</div>
                    </div>
                    <div>
                      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Max</div>
                      <div className="text-[11px] font-bold text-slate-700 num leading-tight mt-0.5">{r.stock_max || '—'}</div>
                    </div>
                    {can('view_purchase_prices') && (
                      <div>
                        <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Valeur</div>
                        <div className="text-[11px] font-bold text-slate-800 num leading-tight mt-0.5 truncate">{formatFCFA(value)}</div>
                      </div>
                    )}
                  </div>

                  {can('manage_stock') && (
                  <div className="flex items-center gap-1 pt-1">
                    <button onClick={() => openAdj(r, 'in')} className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-bold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-all active:scale-95" title="Entrée">
                      <Plus className="w-3 h-3" />Entrée
                    </button>
                    <button onClick={() => openAdj(r, 'out')} className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-bold bg-red-50 text-red-700 hover:bg-red-100 transition-all active:scale-95" title="Sortie">
                      <Minus className="w-3 h-3" />Sortie
                    </button>
                    {canTransfer && (
                      <button onClick={() => openAdj(r, 'transfer')} className="shrink-0 w-8 h-[26px] inline-flex items-center justify-center rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 transition-all active:scale-95" title="Transfert">
                        <ArrowRightLeft className="w-3 h-3" />
                      </button>
                    )}
                    <button onClick={() => openAdj(r, 'inventory')} className="shrink-0 w-8 h-[26px] inline-flex items-center justify-center rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 transition-all active:scale-95" title="Inventaire">
                      <ClipboardList className="w-3 h-3" />
                    </button>
                  </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : tab === 'movements' ? (
        <>
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider">
            <span className="shrink-0 px-2 py-1 rounded-full bg-slate-100 text-slate-600 num">{filteredMoves.length} / {moves.length}</span>
            {(mvDateFrom || mvDateTo) && (
              <span className="shrink-0 px-2 py-1 rounded-full bg-brand-50 text-brand-700 inline-flex items-center gap-1 normal-case tracking-normal num text-[10px]">
                <Calendar className="w-3 h-3" />
                {mvDateFrom ? new Date(mvDateFrom).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '…'}
                {' → '}
                {mvDateTo ? new Date(mvDateTo).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '…'}
                <button onClick={() => { setMvDateFrom(''); setMvDateTo(''); }} className="ml-0.5 hover:text-brand-900"><X className="w-3 h-3" /></button>
              </span>
            )}
          </div>

          {filteredMoves.length === 0 ? (
            <div className="card-premium"><EmptyState icon={History} title={(mvDateFrom || mvDateTo) ? 'Aucun mouvement sur la période' : 'Aucun mouvement'} description={(mvDateFrom || mvDateTo) ? 'Essayez une autre période.' : 'Les mouvements de stock apparaîtront ici après chaque opération.'} /></div>
          ) : (
          <div className={`rounded-2xl border border-slate-200 bg-white overflow-hidden divide-y divide-slate-100 count-up ${flashKey === 'stockIn' ? 'waarwi-flash waarwi-flash-scroll' : ''}`}>
            {filteredMoves.map(m => {
              const qty = Number(m.quantity);
              const positive = qty >= 0;
              return (
                <div key={m.id} className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-50/60 transition-colors">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                    positive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                  }`}>
                    {positive ? <ArrowDownCircle className="w-4 h-4" /> : <ArrowUpCircle className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-1.5 flex-wrap">
                      <span className="text-[12px] font-semibold text-slate-900 break-words min-w-0">{(m.articles as any)?.name}</span>
                      <span className={`shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${mvTypeColor[m.movement_type] || 'bg-slate-100 text-slate-700'}`}>
                        {mvTypeLabel[m.movement_type] || m.movement_type}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-slate-500">
                      <span className="font-mono truncate">{(m.articles as any)?.internal_ref}</span>
                      <span className="shrink-0">·</span>
                      <span className="shrink-0 num">{formatDateTime(m.created_at)}</span>
                    </div>
                    {m.note && <div className="text-[10px] text-slate-400 break-words mt-0.5">{m.note}</div>}
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-[13px] font-bold num ${positive ? 'text-emerald-700' : 'text-red-600'}`}>
                      {positive ? '+' : ''}{qty}
                    </div>
                    <div className="text-[9px] text-slate-400 num mt-0.5">{m.previous_qty} → {m.new_qty}</div>
                  </div>
                </div>
              );
            })}
          </div>
          )}
        </>
      ) : null}

      {tab === 'lots' && (
        <LotsView lots={lots} stockMethod={stockMethod} />
      )}

      <PremiumDateRangePicker
        open={mvPickerOpen}
        onClose={() => setMvPickerOpen(false)}
        from={mvDateFrom}
        to={mvDateTo}
        onApply={(f, t) => { setMvDateFrom(f); setMvDateTo(t); setMvPickerOpen(false); }}
      />

      {/* Adjust modal */}
      <Modal open={adjOpen} onClose={() => setAdjOpen(false)}
        title={{ in: 'Entrée de stock', out: 'Sortie de stock', transfer: 'Transfert de stock', inventory: 'Saisie d\'inventaire' }[adjMode]}
        size="sm"
        footer={<><button onClick={() => setAdjOpen(false)} className="btn-secondary">Annuler</button><button onClick={saveAdj} disabled={saving} className="btn-primary">{saving && <Loader2 className="w-4 h-4 animate-spin" />}Valider</button></>}
      >
        {adjRow && (
          <div className="space-y-3">
            <div className="p-3 rounded-xl bg-gradient-to-br from-slate-50 to-white border border-slate-200">
              <div className="text-[12px] font-semibold text-slate-900 truncate">{adjRow.name}</div>
              <div className="text-[10px] text-slate-500 font-mono mt-0.5">{adjRow.internal_ref}</div>
              <div className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-700">
                Stock actuel : <span className="num">{adjRow.quantity}</span>
              </div>
            </div>

            <div>
              <label className="label">Article</label>
              <SearchableSelect
                options={rows.map(r => ({ value: r.article_id, label: r.name, sublabel: r.internal_ref }))}
                value={adjRow?.article_id || ''}
                onChange={v => { const r = rows.find(x => x.article_id === v); if (r) { setAdjRow(r); setAdjInventoryQty(r.quantity); } }}
                placeholder="Rechercher un article..."
              />
            </div>

            {adjMode === 'inventory' ? (
              <div>
                <label className="label">Quantité réelle comptée</label>
                <input type="number" min={0} value={adjInventoryQty} onChange={e => setAdjInventoryQty(e.target.value === '' ? '' : Number(e.target.value))} className="input text-lg font-semibold" autoFocus={desktopAutoFocus} />
                {adjInventoryQty !== '' && <p className="text-xs mt-1 text-slate-500">Écart : {Number(adjInventoryQty) - adjRow.quantity > 0 ? '+' : ''}{Number(adjInventoryQty) - adjRow.quantity}</p>}
              </div>
            ) : adjMode === 'transfer' ? (
              <>
                <div>
                  <label className="label">Magasin de destination</label>
                  <SearchableSelect
                    options={sites.filter(s => s.id !== currentSite?.id).map(s => ({ value: s.id, label: s.name }))}
                    value={adjTargetSite}
                    onChange={v => setAdjTargetSite(v)}
                    placeholder="— Choisir —"
                    searchable={false}
                  />
                </div>
                <div>
                  <label className="label">Quantité à transférer</label>
                  <input type="number" min={1} value={adjQty} onChange={e => setAdjQty(e.target.value === '' ? '' : Number(e.target.value))} className="input" autoFocus={desktopAutoFocus} />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="label">Quantité</label>
                  <input type="number" min={1} value={adjQty} onChange={e => setAdjQty(e.target.value === '' ? '' : Number(e.target.value))} className="input text-lg font-semibold" autoFocus={desktopAutoFocus} />
                </div>
                {adjMode === 'in' && stockMethod === 'lot' && (
                  <>
                    <div>
                      <label className="label">N° de lot *</label>
                      <input value={adjBatchNumber} onChange={e => setAdjBatchNumber(e.target.value)} className="input" placeholder="Ex: LOT-2026-001" />
                    </div>
                    <div>
                      <label className="label">Date de péremption</label>
                      <input type="date" value={adjExpiryDate} onChange={e => setAdjExpiryDate(e.target.value)} className="input" />
                    </div>
                    <div>
                      <label className="label">Prix d'achat (lot)</label>
                      <input type="number" min={0} value={adjPurchasePrice} onChange={e => setAdjPurchasePrice(e.target.value === '' ? '' : Number(e.target.value))} className="input" placeholder="FCFA" />
                    </div>
                  </>
                )}
                {adjMode === 'in' && stockMethod === 'cmup' && (
                  <div>
                    <label className="label">Prix d'achat (cette entrée)</label>
                    <input type="number" min={0} value={adjPurchasePrice} onChange={e => setAdjPurchasePrice(e.target.value === '' ? '' : Number(e.target.value))} className="input" placeholder="FCFA" />
                    <p className="text-[10px] text-slate-500 mt-1">Le CMUP sera recalculé automatiquement</p>
                  </div>
                )}
              </>
            )}

            <div>
              <label className="label">Note / motif</label>
              <input value={adjNote} onChange={e => setAdjNote(e.target.value)} className="input" placeholder="Achat, retour, perte, correction…" />
            </div>
          </div>
        )}
      </Modal>

      {/* Lot picker for sortie */}
      <LotPickerModal
        open={lotPickerOutOpen}
        onClose={() => setLotPickerOutOpen(false)}
        items={lotPickerOutRow ? [{ article_id: lotPickerOutRow.article_id, name: lotPickerOutRow.name, quantity: lotPickerOutQty }] : []}
        onConfirm={async (selections) => {
          if (!currentSite || !selections[0]) return;
          setLotPickerOutOpen(false);
          const s = selections[0];
          const assignments = s.assignments.filter(a => a.quantity > 0).map(a => ({ lot_id: a.lot_id, quantity: a.quantity }));
          try {
            await supabase.rpc('deduct_stock_manual_lots', {
              p_article_id: s.article_id,
              p_site_id: currentSite.id,
              p_total_quantity: lotPickerOutQty,
              p_lot_assignments: assignments,
              p_movement_type: 'adjustment_out',
              p_note: adjNote || 'Sortie stock (lot)',
            });
            success('Sortie de stock effectuée');
            await load();
          } catch (e: any) {
            error(e.message || 'Erreur');
          }
        }}
        title="Choisir les lots pour la sortie"
        confirmLabel="Confirmer la sortie"
      />
    </div>
  );
}

/* ===================== LOTS VIEW ===================== */
function LotsView({ lots, stockMethod }: { lots: LotRow[]; stockMethod: StockMethod }) {
  const [search, setSearch] = useState('');

  if (stockMethod !== 'lot') {
    return (
      <div className="card-premium py-10 text-center">
        <PackageOpen className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="text-sm font-semibold text-slate-600">Suivi par lot non activé</p>
        <p className="text-xs text-slate-400 mt-1">Activez la méthode "Par lot" dans Paramètres &gt; Gestion des stocks.</p>
      </div>
    );
  }

  const today = new Date().toISOString().split('T')[0];
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];

  const filtered = lots.filter(l => {
    if (!search) return true;
    const q = search.toLowerCase();
    return l.article_name.toLowerCase().includes(q) || l.article_ref.toLowerCase().includes(q) || l.batch_number.toLowerCase().includes(q);
  });

  const expired = filtered.filter(l => l.expiry_date && l.expiry_date <= today);
  const expiringSoon = filtered.filter(l => l.expiry_date && l.expiry_date > today && l.expiry_date <= soon);
  const ok = filtered.filter(l => !l.expiry_date || l.expiry_date > soon);

  const formatDate = (d: string | null) => d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  const daysUntil = (d: string | null) => {
    if (!d) return null;
    const diff = Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
    return diff;
  };

  return (
    <div className="space-y-3">
      {/* Expiry alerts */}
      {expired.length > 0 && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200">
          <div className="flex items-center gap-2 text-xs font-bold text-red-700 mb-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />{expired.length} lot{expired.length > 1 ? 's' : ''} périmé{expired.length > 1 ? 's' : ''}
          </div>
          <div className="space-y-1">
            {expired.slice(0, 5).map(l => (
              <div key={l.id} className="text-[11px] text-red-600 flex items-center gap-2">
                <span className="font-semibold">{l.batch_number}</span>
                <span className="text-red-500">{l.article_name}</span>
                <span className="ml-auto font-mono">{formatDate(l.expiry_date)}</span>
              </div>
            ))}
            {expired.length > 5 && <div className="text-[10px] text-red-500">+{expired.length - 5} autres...</div>}
          </div>
        </div>
      )}

      {expiringSoon.length > 0 && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
          <div className="flex items-center gap-2 text-xs font-bold text-amber-700 mb-1.5">
            <Clock className="w-3.5 h-3.5" />{expiringSoon.length} lot{expiringSoon.length > 1 ? 's' : ''} expire{expiringSoon.length > 1 ? 'nt' : ''} dans les 30 jours
          </div>
          <div className="space-y-1">
            {expiringSoon.slice(0, 5).map(l => (
              <div key={l.id} className="text-[11px] text-amber-700 flex items-center gap-2">
                <span className="font-semibold">{l.batch_number}</span>
                <span className="text-amber-600">{l.article_name}</span>
                <span className="ml-auto font-mono">{daysUntil(l.expiry_date)}j</span>
              </div>
            ))}
            {expiringSoon.length > 5 && <div className="text-[10px] text-amber-500">+{expiringSoon.length - 5} autres...</div>}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-2">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Rechercher lot, article..."
          className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400"
        />
        <span className="text-[10px] font-bold text-slate-500 whitespace-nowrap">{filtered.length} lot{filtered.length > 1 ? 's' : ''}</span>
      </div>

      {/* Lots list */}
      {filtered.length === 0 ? (
        <div className="card-premium py-8 text-center">
          <PackageOpen className="w-7 h-7 text-slate-300 mx-auto mb-2" />
          <p className="text-sm font-semibold text-slate-600">Aucun lot en stock</p>
          <p className="text-xs text-slate-400 mt-1">Les lots apparaitront ici après une entrée de stock en mode lot.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map(l => {
            const days = daysUntil(l.expiry_date);
            const isExpired = l.expiry_date && l.expiry_date <= today;
            const isSoon = l.expiry_date && !isExpired && l.expiry_date <= soon;
            return (
              <div key={l.id} className={`p-3 rounded-xl border bg-white ${isExpired ? 'border-red-200 bg-red-50/50' : isSoon ? 'border-amber-200 bg-amber-50/30' : 'border-slate-200'}`}>
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900 truncate">{l.article_name}</span>
                      <span className="text-[10px] font-mono text-slate-400">{l.article_ref}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-[11px]">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 font-semibold">
                        <PackageOpen className="w-3 h-3" />{l.batch_number}
                      </span>
                      {l.expiry_date && (
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md font-semibold ${isExpired ? 'bg-red-100 text-red-700' : isSoon ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                          <Calendar className="w-3 h-3" />{formatDate(l.expiry_date)}
                          {days !== null && <span className="font-bold">({days}j)</span>}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold text-slate-900 num">{l.remaining_quantity}</div>
                    <div className="text-[9px] text-slate-400">/ {l.initial_quantity}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
 *  STOCK LIST EDIT VIEW — Bulk inline editing
 * ════════════════════════════════════════════════════════════════════════════ */
type ListEditEntry = { article_id: string; qty: number | ''; note: string; lot_number: string };

function StockListEditView({
  filtered, listEditMode, setListEditMode, listEdits, setListEdits,
  listSaving, setListSaving, listInputRefs, currentSite,
  canViewPrices, onSaved, successToast, errorToast, stockMethod,
}: {
  filtered: Row[];
  listEditMode: 'in' | 'out' | 'inventory';
  setListEditMode: (m: 'in' | 'out' | 'inventory') => void;
  listEdits: Map<string, ListEditEntry>;
  setListEdits: (m: Map<string, ListEditEntry>) => void;
  listSaving: boolean;
  setListSaving: (s: boolean) => void;
  listInputRefs: React.MutableRefObject<Map<string, HTMLInputElement>>;
  currentSite: any;
  canViewPrices: boolean;
  onSaved: () => Promise<void>;
  successToast: (m: string) => void;
  errorToast: (m: string) => void;
  stockMethod: string;
}) {
  const lotMode = stockMethod === 'lot';
  const editCount = Array.from(listEdits.values()).filter(e => e.qty !== '' && Number(e.qty) !== 0).length;

  const updateEdit = (articleId: string, qty: number | '', note?: string, lot_number?: string) => {
    const next = new Map(listEdits);
    const existing = next.get(articleId);
    next.set(articleId, {
      article_id: articleId,
      qty,
      note: note ?? existing?.note ?? '',
      lot_number: lot_number ?? existing?.lot_number ?? '',
    });
    setListEdits(next);
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      const nextRow = filtered[index + 1];
      if (nextRow) listInputRefs.current.get(nextRow.article_id)?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevRow = filtered[index - 1];
      if (prevRow) listInputRefs.current.get(prevRow.article_id)?.focus();
    }
  };

  const saveBulk = async () => {
    if (!currentSite) return;
    const entries = Array.from(listEdits.values()).filter(e => e.qty !== '' && Number(e.qty) !== 0);
    if (entries.length === 0) { errorToast('Aucune modification à enregistrer'); return; }
    if (lotMode && listEditMode === 'in') {
      const missing = entries.find(e => !e.lot_number?.trim());
      if (missing) { errorToast('Numéro de lot requis pour toutes les entrées'); return; }
    }
    setListSaving(true);
    let savedCount = 0;
    try {
      for (const entry of entries) {
        const qty = Number(entry.qty);
        if (listEditMode === 'inventory') {
          const row = filtered.find(r => r.article_id === entry.article_id);
          if (!row) continue;
          const diff = qty - row.quantity;
          if (diff === 0) continue;
          const { error: e } = await supabase.rpc('adjust_stock', {
            p_article_id: entry.article_id, p_site_id: currentSite.id,
            p_quantity: diff, p_movement_type: 'inventory',
            p_note: entry.note || `Inventaire: ${row.quantity} -> ${qty}`,
          });
          if (e) throw e;
        } else if (listEditMode === 'in' && lotMode) {
          const { error: e } = await supabase.rpc('adjust_stock_lot', {
            p_article_id: entry.article_id, p_site_id: currentSite.id,
            p_quantity: qty, p_batch_number: entry.lot_number.trim(),
            p_expiry_date: null,
            p_purchase_price: filtered.find(r => r.article_id === entry.article_id)?.purchase_price ?? 0,
            p_note: entry.note || `Lot ${entry.lot_number.trim()}`,
          });
          if (e) throw e;
        } else {
          const signedQty = listEditMode === 'in' ? qty : -qty;
          const type = listEditMode === 'in' ? 'adjustment_in' : 'adjustment_out';
          const { error: e } = await supabase.rpc('adjust_stock', {
            p_article_id: entry.article_id, p_site_id: currentSite.id,
            p_quantity: signedQty, p_movement_type: type,
            p_note: entry.note || (listEditMode === 'in' ? 'Entrée stock (masse)' : 'Sortie stock (masse)'),
          });
          if (e) throw e;
        }
        savedCount++;
      }
      successToast(`${savedCount} article${savedCount > 1 ? 's' : ''} mis à jour`);
      await onSaved();
    } catch (e: any) {
      errorToast(e.message || 'Erreur lors de la sauvegarde');
    } finally {
      setListSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      {/* Mode selector + save button */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="inline-flex rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          <button
            onClick={() => { setListEditMode('in'); setListEdits(new Map()); }}
            className={`px-3 py-1.5 text-[11px] font-bold transition-all ${listEditMode === 'in' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-emerald-50'}`}
          >
            <ArrowDownCircle className="w-3.5 h-3.5 inline mr-1" />Entrée
          </button>
          <button
            onClick={() => { setListEditMode('out'); setListEdits(new Map()); }}
            className={`px-3 py-1.5 text-[11px] font-bold border-x border-slate-200 transition-all ${listEditMode === 'out' ? 'bg-red-600 text-white' : 'text-slate-600 hover:bg-red-50'}`}
          >
            <ArrowUpCircle className="w-3.5 h-3.5 inline mr-1" />Sortie
          </button>
          <button
            onClick={() => { setListEditMode('inventory'); setListEdits(new Map()); }}
            className={`px-3 py-1.5 text-[11px] font-bold transition-all ${listEditMode === 'inventory' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-blue-50'}`}
          >
            <ClipboardList className="w-3.5 h-3.5 inline mr-1" />Inventaire
          </button>
        </div>

        <button
          onClick={saveBulk}
          disabled={editCount === 0 || listSaving}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-br from-brand-600 to-brand-800 text-white shadow-glow hover:shadow-premium disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95"
        >
          {listSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Enregistrer{editCount > 0 && ` (${editCount})`}
        </button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/80">
                <th className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 w-[30%]">Article</th>
                <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 text-center w-[80px]">Stock</th>
                <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 text-center w-[60px]">Min</th>
                {canViewPrices && <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 text-right w-[100px]">P.Achat</th>}
                <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 text-center w-[100px]">
                  {listEditMode === 'in' ? 'Qte entree' : listEditMode === 'out' ? 'Qte sortie' : 'Nvelle qte'}
                </th>
                {lotMode && listEditMode === 'in' && (
                  <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 w-[110px]">N° Lot *</th>
                )}
                <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 w-[120px] hidden md:table-cell">Note</th>
                <th className="px-2 py-2 w-[30px]"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, idx) => {
                const edit = listEdits.get(r.article_id);
                const hasValue = edit && edit.qty !== '' && Number(edit.qty) !== 0;
                const out = r.quantity <= 0;
                const low = !out && r.quantity <= r.stock_min;
                return (
                  <tr key={r.article_id} className={`border-b border-slate-50 transition-colors ${hasValue ? 'bg-brand-50/30' : 'hover:bg-slate-50/50'}`}>
                    <td className="px-3 py-1.5">
                      <div className="text-[11px] font-semibold text-slate-900 leading-tight">{r.name}</div>
                      <div className="text-[9px] text-slate-400 font-mono">{r.internal_ref}</div>
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <span className={`inline-block text-xs font-bold num px-1.5 py-0.5 rounded ${out ? 'bg-red-100 text-red-700' : low ? 'bg-amber-100 text-amber-700' : 'text-slate-800'}`}>
                        {r.quantity}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-center text-[11px] text-slate-500 num">{r.stock_min}</td>
                    {canViewPrices && <td className="px-2 py-1.5 text-right text-[11px] text-slate-600 num">{formatFCFA(r.purchase_price)}</td>}
                    <td className="px-2 py-1.5">
                      <input
                        ref={el => { if (el) listInputRefs.current.set(r.article_id, el); }}
                        type="number"
                        min={0}
                        placeholder={listEditMode === 'inventory' ? String(r.quantity) : '0'}
                        value={edit?.qty ?? ''}
                        onChange={e => updateEdit(r.article_id, e.target.value === '' ? '' : Number(e.target.value), edit?.note, edit?.lot_number)}
                        onKeyDown={e => handleKeyDown(e, idx)}
                        className="w-full text-center text-xs font-bold num px-2 py-1.5 rounded-lg border border-slate-200 focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20 outline-none transition-all bg-white"
                      />
                    </td>
                    <td className="px-2 py-1.5 hidden md:table-cell">
                      <input
                        type="text"
                        placeholder="..."
                        value={edit?.note ?? ''}
                        onChange={e => updateEdit(r.article_id, edit?.qty ?? '', e.target.value, edit?.lot_number)}
                        className="w-full text-[10px] px-2 py-1.5 rounded-lg border border-slate-200 focus:border-brand-400 focus:ring-1 focus:ring-brand-500/20 outline-none transition-all bg-white"
                      />
                    </td>
                    {lotMode && listEditMode === 'in' && (
                      <td className="px-2 py-1.5">
                        <input
                          type="text"
                          placeholder="LOT-…"
                          value={edit?.lot_number ?? ''}
                          onChange={e => updateEdit(r.article_id, edit?.qty ?? '', edit?.note, e.target.value)}
                          className={`w-full text-[10px] px-2 py-1.5 rounded-lg border focus:ring-1 outline-none transition-all bg-white ${
                            hasValue && !edit?.lot_number?.trim()
                              ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20'
                              : 'border-slate-200 focus:border-brand-400 focus:ring-brand-500/20'
                          }`}
                        />
                      </td>
                    )}
                    <td className="px-2 py-1.5">
                      {hasValue && <Check className="w-3.5 h-3.5 text-emerald-500" />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}