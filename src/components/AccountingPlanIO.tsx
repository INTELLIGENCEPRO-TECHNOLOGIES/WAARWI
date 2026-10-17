import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Upload, FileSpreadsheet, AlertTriangle, CheckCircle2, XCircle, Loader2, ArrowRight, FileDown, ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { sanitizeCsvValue, desanitizeCsvValue } from '../lib/csvSanitize';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { usePermissions } from '../lib/permissions';
import { Modal } from './Modal';

interface AccountRow {
  code: string;
  name: string;
  class?: number;
  account_type?: string;
  is_active?: boolean;
}

interface PreviewRow {
  line: number;
  code: string;
  name: string;
  status: 'created' | 'renamed' | 'unchanged' | 'error';
  error?: string;
}

interface ImportResult {
  success: boolean;
  dry_run: boolean;
  total: number;
  created: number;
  renamed: number;
  unchanged: number;
  error_count: number;
  errors: { line: number; code: string; name: string; error: string }[];
  rows: PreviewRow[];
}

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_ROWS = 5000;
const PAGE_SIZE = 50;

const CODE_ALIASES = ['code', 'code comptable', 'codecomptable', 'compte', 'n° compte', 'numéro', 'numero', 'account_code'];
const NAME_ALIASES = ['name', 'intitulé', 'intitule', 'libellé', 'libelle', 'désignation', 'designation', 'nom'];

function normalizeHeader(h: string): string {
  return h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9_]/g, '').trim();
}

function findColumn(headers: string[], aliases: string[]): number {
  const normalizedAliases = aliases.map(normalizeHeader);
  return headers.findIndex(h => normalizedAliases.includes(normalizeHeader(h)));
}

function isRowEmpty(row: Record<string, any>): boolean {
  return Object.values(row).every(v => v === undefined || v === null || String(v).trim() === '');
}

export function AccountingPlanIO({ accounts, onImportDone }: { accounts: AccountRow[]; onImportDone: () => void }) {
  const { tenant } = useApp();
  const { success, error: showError } = useToast();
  const { can } = usePermissions();
  const canView = can('view_accounting');
  const canManage = can('manage_accounting');
  const fileRef = useRef<HTMLInputElement>(null);

  const [exporting, setExporting] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [importStep, setImportStep] = useState<'upload' | 'preview' | 'done'>('upload');
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [finalResult, setFinalResult] = useState<ImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState('');
  const [page, setPage] = useState(0);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) setShowExportMenu(false);
    }
    if (showExportMenu) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showExportMenu]);

  const doExport = async (format: 'xlsx' | 'csv') => {
    if (!tenant) return;
    setExporting(true);
    setShowExportMenu(false);
    try {
      const XLSX = await import('xlsx');

      if (format === 'xlsx') {
        const rows = accounts.map(a => ({
          Code: a.code,
          'Intitulé': a.name,
          Classe: a.class ?? '',
          Type: a.account_type ?? '',
          Actif: a.is_active !== false ? 'Oui' : 'Non',
        }));
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(rows);
        ws['!cols'] = [{ wch: 10 }, { wch: 40 }, { wch: 8 }, { wch: 12 }, { wch: 6 }];
        XLSX.utils.book_append_sheet(wb, ws, 'Plan comptable');
        XLSX.writeFile(wb, `plan_comptable_${tenant.id.slice(0, 8)}.xlsx`);
      } else {
        const rows = accounts.map(a => ({
          Code: sanitizeCsvValue(a.code),
          'Intitulé': sanitizeCsvValue(a.name),
          Classe: a.class ?? '',
          Type: a.account_type ?? '',
          Actif: a.is_active !== false ? 'Oui' : 'Non',
        }));
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, 'Plan comptable');
        const csvContent = XLSX.utils.sheet_to_csv(ws, { FS: ';' });
        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `plan_comptable_${tenant.id.slice(0, 8)}.csv`;
        link.click();
        URL.revokeObjectURL(url);
      }
      success('Export terminé');
    } catch (e: any) {
      showError(e.message || 'Erreur export');
    } finally {
      setExporting(false);
    }
  };

  const downloadTemplate = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const sample = [
      { Code: '1011000', 'Intitulé': 'Capital social' },
      { Code: '2110000', 'Intitulé': 'Frais de développement' },
      { Code: '6010000', 'Intitulé': 'Achats de marchandises' },
    ];
    const ws = XLSX.utils.json_to_sheet(sample);
    ws['!cols'] = [{ wch: 10 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Modèle');
    XLSX.writeFile(wb, 'modele_import_plan_comptable.xlsx');
  };

  const openImport = () => {
    setImportOpen(true);
    setImportStep('upload');
    setPreview(null);
    setFinalResult(null);
    setFileName('');
    setPage(0);
  };

  const handleFile = async (file: File) => {
    if (!tenant) return;

    if (file.size > MAX_FILE_SIZE) {
      showError(`Fichier trop volumineux (max ${MAX_FILE_SIZE / 1024 / 1024} Mo)`);
      return;
    }

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext || '')) {
      showError('Format non supporté. Utilisez .xlsx, .xls ou .csv');
      return;
    }

    setImporting(true);
    setFileName(file.name);
    try {
      const XLSX = await import('xlsx');
      let rows: { code: string; name: string }[] = [];

      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', codepage: 65001 });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '', raw: false });

      if (json.length === 0) { showError('Fichier vide ou sans données'); setImporting(false); return; }

      const headers = Object.keys(json[0]);
      const codeKey = headers.find(h => findColumn([h], CODE_ALIASES) >= 0);
      const nameKey = headers.find(h => findColumn([h], NAME_ALIASES) >= 0);
      if (!codeKey || !nameKey) { showError('Colonnes Code et Intitulé introuvables'); setImporting(false); return; }

      rows = json
        .filter(r => !isRowEmpty(r))
        .map(r => ({
          code: desanitizeCsvValue(String(r[codeKey] ?? '').trim()),
          name: desanitizeCsvValue(String(r[nameKey] ?? '').trim()),
        }));

      if (rows.length === 0) { showError('Aucune ligne valide'); setImporting(false); return; }
      if (rows.length > MAX_ROWS) { showError(`Maximum ${MAX_ROWS} lignes (reçu: ${rows.length})`); setImporting(false); return; }

      const { data, error: rpcErr } = await supabase.rpc('import_accounting_plan', {
        p_tenant_id: tenant.id,
        p_rows: rows,
        p_dry_run: true,
      });

      if (rpcErr) { showError(rpcErr.message); setImporting(false); return; }

      setPreview(data as unknown as ImportResult);
      setImportStep('preview');
      setPage(0);
    } catch (e: any) {
      showError(e.message || 'Erreur lecture fichier');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const confirmImport = async () => {
    if (!tenant || !preview) return;

    setImporting(true);
    try {
      const allRows = preview.rows.map(r => ({ code: r.code, name: r.name }));

      const { data, error: rpcErr } = await supabase.rpc('import_accounting_plan', {
        p_tenant_id: tenant.id,
        p_rows: allRows,
        p_dry_run: false,
      });

      if (rpcErr) { showError(rpcErr.message); return; }

      const result = data as unknown as ImportResult;
      setFinalResult(result);
      setImportStep('done');

      if (result.success) {
        success(`Import réussi : ${result.created} créé(s), ${result.renamed} renommé(s), ${result.unchanged} inchangé(s)`);
        onImportDone();
      } else {
        showError('Import échoué — des erreurs ont été détectées');
      }
    } catch (e: any) {
      showError(e.message || 'Erreur import');
    } finally {
      setImporting(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  if (!canView && !canManage) return null;

  const statusBadge = (status: string) => {
    switch (status) {
      case 'created': return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-700"><CheckCircle2 className="w-3 h-3" />Nouveau</span>;
      case 'renamed': return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-700"><ArrowRight className="w-3 h-3" />Renommé</span>;
      case 'unchanged': return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-neutral-100 text-neutral-500">Inchangé</span>;
      case 'error': return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-50 text-red-700"><XCircle className="w-3 h-3" />Erreur</span>;
      default: return null;
    }
  };

  const allRows = preview?.rows || [];
  const totalPages = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));
  const pagedRows = allRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const hasErrors = (preview?.error_count ?? 0) > 0;

  return (
    <>
      <div className="flex items-center gap-1.5">
        {canView && (
          <div className="relative" ref={exportMenuRef}>
            <button
              onClick={() => setShowExportMenu(v => !v)}
              disabled={exporting || accounts.length === 0}
              className="btn-icon"
              title="Exporter le plan comptable"
            >
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            </button>
            {showExportMenu && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-white rounded-lg shadow-lg border border-neutral-200 py-1 min-w-[180px] animate-in fade-in slide-in-from-top-1 duration-150">
                <button onClick={() => doExport('xlsx')} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50 transition">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Excel (.xlsx)
                </button>
                <button onClick={() => doExport('csv')} className="flex items-center gap-2 w-full px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50 transition">
                  <FileDown className="w-4 h-4 text-blue-600" /> CSV (UTF-8)
                </button>
              </div>
            )}
          </div>
        )}

        {canManage && (
          <button onClick={openImport} className="btn-icon" title="Importer un plan comptable">
            <Upload className="w-4 h-4" />
          </button>
        )}
      </div>

      {canManage && <Modal open={importOpen} onClose={() => !importing && setImportOpen(false)} title="Import du plan comptable" size="lg"
        footer={
          importStep === 'preview' && preview && !hasErrors && (preview.created > 0 || preview.renamed > 0) ? (
            <div className="flex items-center gap-2">
              <button onClick={() => { setImportStep('upload'); setPreview(null); setFileName(''); }} disabled={importing} className="text-xs font-medium text-neutral-500 hover:text-neutral-700 transition">Retour</button>
              <button onClick={confirmImport} disabled={importing} className="inline-flex items-center gap-1.5 px-4 py-2 bg-neutral-900 text-white text-xs font-medium rounded-md hover:bg-neutral-800 transition active:scale-[0.97] disabled:opacity-50">
                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Valider l\'import'}
              </button>
            </div>
          ) : importStep === 'preview' && preview && hasErrors ? (
            <button onClick={() => { setImportStep('upload'); setPreview(null); setFileName(''); }} className="text-xs font-medium text-neutral-500 hover:text-neutral-700 transition">Retour</button>
          ) : importStep === 'done' ? (
            <button onClick={() => setImportOpen(false)} className="inline-flex items-center gap-1.5 px-4 py-2 bg-neutral-900 text-white text-xs font-medium rounded-md hover:bg-neutral-800 transition active:scale-[0.97]">Fermer</button>
          ) : undefined
        }
      >
        {importStep === 'upload' && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-blue-800 space-y-1">
                <p className="font-medium">Formats acceptés : .xlsx, .xls, .csv</p>
                <p>Le fichier doit contenir au minimum les colonnes <span className="font-mono font-medium">Code</span> et <span className="font-mono font-medium">Intitulé</span>.</p>
                <p>Codes : exactement 7 chiffres, classe 1 à 8. Maximum {MAX_ROWS.toLocaleString('fr-FR')} lignes, {MAX_FILE_SIZE / 1024 / 1024} Mo.</p>
              </div>
            </div>

            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
                dragOver ? 'border-blue-400 bg-blue-50/50' : 'border-neutral-200 hover:border-neutral-300'
              }`}
              onClick={() => fileRef.current?.click()}
            >
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
              {importing ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="w-8 h-8 text-neutral-400 animate-spin" />
                  <p className="text-sm text-neutral-500">Analyse en cours...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="w-8 h-8 text-neutral-300" />
                  <p className="text-sm text-neutral-600">Glissez-déposez un fichier ou cliquez pour parcourir</p>
                  <p className="text-xs text-neutral-400">.xlsx, .xls, .csv</p>
                </div>
              )}
            </div>

            <button onClick={downloadTemplate} className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-700 transition">
              <FileSpreadsheet className="w-3.5 h-3.5" /> Télécharger le modèle d'import
            </button>
          </div>
        )}

        {importStep === 'preview' && preview && (
          <div className="space-y-4">
            {fileName && (
              <div className="flex items-center gap-2 text-xs text-neutral-500">
                <FileText className="w-3.5 h-3.5" />
                <span className="truncate max-w-[300px] font-medium">{fileName}</span>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Total" value={preview.total} />
              <Stat label="Nouveaux" value={preview.created} color="emerald" />
              <Stat label="Renommés" value={preview.renamed} color="amber" />
              <Stat label="Erreurs" value={preview.error_count} color="red" />
            </div>

            {hasErrors && (
              <div className="p-3 bg-red-50 rounded-lg flex items-start gap-2">
                <XCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-red-800">
                  <p className="font-medium">{preview.error_count} erreur(s) détectée(s) — l'import ne peut pas être validé en l'état.</p>
                  <p>Corrigez les erreurs dans votre fichier et recommencez.</p>
                </div>
              </div>
            )}

            {!hasErrors && preview.created === 0 && preview.renamed === 0 && (
              <div className="p-3 bg-neutral-50 rounded-lg flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-neutral-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-neutral-600">Tous les comptes existent déjà avec le même intitulé. Aucune modification nécessaire.</p>
              </div>
            )}

            <div className="space-y-1">
              <p className="text-xs font-semibold text-neutral-700">
                Détail ({allRows.length} ligne{allRows.length > 1 ? 's' : ''})
              </p>
              <div className="max-h-72 overflow-y-auto rounded-lg border border-neutral-100">
                <table className="w-full text-xs">
                  <thead className="bg-neutral-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-1.5 text-left text-neutral-400 font-medium w-10">#</th>
                      <th className="px-3 py-1.5 text-left text-neutral-400 font-medium w-20">Code</th>
                      <th className="px-3 py-1.5 text-left text-neutral-400 font-medium">Intitulé</th>
                      <th className="px-3 py-1.5 text-left text-neutral-400 font-medium w-24">Statut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-50">
                    {pagedRows.map(r => (
                      <tr key={r.line} className={r.status === 'error' ? 'bg-red-50/50' : ''}>
                        <td className="px-3 py-1.5 text-neutral-400">L{r.line}</td>
                        <td className="px-3 py-1.5 font-mono text-neutral-600">{r.code}</td>
                        <td className="px-3 py-1.5 text-neutral-700 truncate max-w-[200px]" title={r.status === 'error' ? r.error : r.name}>
                          {r.status === 'error' ? (
                            <span className="text-red-600">{r.error}</span>
                          ) : r.name}
                        </td>
                        <td className="px-3 py-1.5">{statusBadge(r.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-1">
                  <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="p-1 rounded hover:bg-neutral-100 disabled:opacity-30 transition">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-[10px] text-neutral-400">{page + 1} / {totalPages}</span>
                  <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="p-1 rounded hover:bg-neutral-100 disabled:opacity-30 transition">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {importStep === 'done' && finalResult && (
          <div className="space-y-4">
            {finalResult.success ? (
              <div className="p-4 bg-emerald-50 rounded-lg flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-emerald-800">Import terminé avec succès</p>
                  <p className="text-xs text-emerald-700 mt-1">
                    {finalResult.created} compte(s) créé(s), {finalResult.renamed} renommé(s), {finalResult.unchanged} inchangé(s).
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-4 bg-red-50 rounded-lg flex items-start gap-3">
                <XCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-red-800">Import échoué</p>
                  <p className="text-xs text-red-700 mt-1">{finalResult.error_count} erreur(s) détectée(s). Aucune modification n'a été appliquée.</p>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>}
    </>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  const colors: Record<string, string> = {
    emerald: 'text-emerald-700 bg-emerald-50',
    amber: 'text-amber-700 bg-amber-50',
    red: 'text-red-700 bg-red-50',
  };
  return (
    <div className={`rounded-lg px-3 py-2 ${color ? colors[color] : 'bg-neutral-50 text-neutral-700'}`}>
      <p className="text-[10px] font-medium opacity-70">{label}</p>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}
