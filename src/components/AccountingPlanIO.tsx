import { useEffect, useRef, useState } from 'react';
import { Download, Upload, FileSpreadsheet, AlertTriangle, CheckCircle2, XCircle, Loader2, ArrowRight, FileDown, ChevronLeft, ChevronRight, FileText } from './Icons';
import { sanitizeCsvValue, desanitizeCsvValue } from '../lib/csvSanitize';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { usePermissions } from '../lib/permissions';
import {useAccountingWork,useAccountingWindowId,mayCloseAccountingWindow} from '../context/AccountingWindowContext';

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

export function AccountingPlanIO({ accounts, onImportDone, importOnly=false,onClose }: { accounts: AccountRow[]; onImportDone: () => void;importOnly?:boolean;onClose?:()=>void }) {
  const { tenant } = useApp();
  const work=useAccountingWork();const windowId=useAccountingWindowId();
  const { success, error: showError } = useToast();
  const { can } = usePermissions();
  const canView = can('view_accounting');
  const canManage = can('manage_accounting');
  const fileRef = useRef<HTMLInputElement>(null);

  const [exporting, setExporting] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  const [importOpen, setImportOpen] = useState(importOnly);
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

  useEffect(()=>{const guard=(event:Event)=>{if(!mayCloseAccountingWindow(event,windowId)||event.defaultPrevented)return;if(importing||(importOpen&&importStep==='preview'&&!window.confirm('Un import est en préparation. Fermer cette fenêtre ?')))event.preventDefault();};window.addEventListener('waarwi:accounting-before-navigate',guard);return()=>window.removeEventListener('waarwi:accounting-before-navigate',guard);},[windowId,importing,importOpen,importStep]);
  if (!canView && !canManage) return null;

  const statusBadge = (status: string) => {
    switch (status) {
      case 'created': return <span className="acc-status valid"><CheckCircle2 className="w-3 h-3" />Nouveau</span>;
      case 'renamed': return <span className="acc-status"><ArrowRight className="w-3 h-3" />Renommé</span>;
      case 'unchanged': return <span className="acc-status draft">Inchangé</span>;
      case 'error': return <span className="acc-status cancelled"><XCircle className="w-3 h-3" />Erreur</span>;
      default: return null;
    }
  };

  const allRows = preview?.rows || [];
  const totalPages = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));
  const pagedRows = allRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const hasErrors = (preview?.error_count ?? 0) > 0;

  return (
    <>
      {!importOnly&&<div className="flex items-center gap-1.5">
        {canView && (
          <div className="relative" ref={exportMenuRef}>
            <button
              onClick={() => setShowExportMenu(v => !v)}
              disabled={exporting || accounts.length === 0}
              className="btn-icon"
              title="Exporter le plan comptable"
              aria-label="Exporter le plan comptable"
              aria-expanded={showExportMenu}
            >
              {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            </button>
            {showExportMenu && (
              <div className="acc-export-menu">
                <button onClick={() => doExport('xlsx')} className="acc-export-option">
                  <FileSpreadsheet size={16} aria-hidden="true" /> Excel (.xlsx)
                </button>
                <button onClick={() => doExport('csv')} className="acc-export-option">
                  <FileDown size={16} aria-hidden="true" /> CSV (UTF-8)
                </button>
              </div>
            )}
          </div>
        )}

        {canManage && (
          <button onClick={()=>work?work.openPlanImport():openImport()} className="btn-icon" title="Importer un plan comptable" aria-label="Importer un plan comptable">
            <Upload className="w-4 h-4" />
          </button>
        )}
      </div>}

      {canManage&&importOpen&&<section className="space-y-3 w-full min-w-0"><div className="acc-toolbar acc-fixed"><strong className="text-sm">Import du plan comptable</strong><span className="acc-spacer"/>{importStep==='preview'&&<button type="button" className="btn-secondary" disabled={importing} onClick={()=>{setImportStep('upload');setPreview(null);setFileName('');}}>Retour</button>}{importStep==='preview'&&preview&&!hasErrors&&(preview.created>0||preview.renamed>0)&&<button type="button" className="btn-primary" disabled={importing} onClick={confirmImport}>{importing?<Loader2 size={15} className="animate-spin"/>:<CheckCircle2 size={15}/>}Valider l’import</button>}<button type="button" className="btn-secondary" disabled={importing} onClick={()=>{if(onClose)onClose();else setImportOpen(false);}}>Fermer</button></div>
        {importStep === 'upload' && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 border-b border-neutral-200">
              <AlertTriangle className="w-4 h-4 text-neutral-600 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-neutral-700 space-y-1">
                <p className="font-medium">Formats acceptés : .xlsx, .xls, .csv</p>
                <p>Le fichier doit contenir au minimum les colonnes <span className="font-mono font-medium">Code</span> et <span className="font-mono font-medium">Intitulé</span>.</p>
                <p>Codes : exactement 7 chiffres, classe 1 à 8. Maximum {MAX_ROWS.toLocaleString('fr-FR')} lignes, {MAX_FILE_SIZE / 1024 / 1024} Mo.</p>
              </div>
            </div>

            <div
              className="acc-file-picker"
              data-drag-over={dragOver}
              onDragOver={e => { e.preventDefault(); if (!importing) setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { if (importing) e.preventDefault(); else onDrop(e); }}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
              />
              <button type="button" className="btn-primary" disabled={importing} onClick={() => fileRef.current?.click()}>
                {importing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                {importing ? 'Analyse en cours…' : 'Choisir le fichier'}
              </button>
              <span className="acc-table-meta">Vous pouvez aussi déposer le fichier ici.</span>
              <button type="button" onClick={downloadTemplate} className="btn-secondary">
                <FileSpreadsheet size={16} /> Télécharger le modèle
              </button>
            </div>
          </div>
        )}

        {importStep === 'preview' && preview && (
          <div className="space-y-4">
            {fileName && (
              <div className="flex items-center gap-2 text-xs text-neutral-500">
                <FileText className="w-3.5 h-3.5" />
                <span className="min-w-0 break-words font-medium">{fileName}</span>
              </div>
            )}

            <div className="acc-summary">
              <Stat label="Total" value={preview.total} />
              <Stat label="Nouveaux" value={preview.created} />
              <Stat label="Renommés" value={preview.renamed} />
              <Stat label="Erreurs" value={preview.error_count} error />
            </div>

            {hasErrors && (
              <div className="p-3 border-b border-neutral-200 flex items-start gap-2">
                <XCircle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-red-800">
                  <p className="font-medium">{preview.error_count} erreur(s) détectée(s) — l'import ne peut pas être validé en l'état.</p>
                  <p>Corrigez les erreurs dans votre fichier et recommencez.</p>
                </div>
              </div>
            )}

            {!hasErrors && preview.created === 0 && preview.renamed === 0 && (
              <div className="p-3 border-b border-neutral-200 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-neutral-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-neutral-600">Tous les comptes existent déjà avec le même intitulé. Aucune modification nécessaire.</p>
              </div>
            )}

            <div className="space-y-1">
              <p className="text-xs font-semibold text-neutral-700">
                Détail ({allRows.length} ligne{allRows.length > 1 ? 's' : ''})
              </p>
              <div className="acc-table-scroll">
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
                      <tr key={r.line}>
                        <td className="px-3 py-1.5 text-neutral-400">L{r.line}</td>
                        <td className="px-3 py-1.5 font-mono text-neutral-600">{r.code}</td>
                        <td className="px-3 py-1.5 text-neutral-700 break-words" title={r.status === 'error' ? r.error : r.name}>
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
                  <button type="button" aria-label="Page précédente" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="acc-icon">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-[10px] text-neutral-400">{page + 1} / {totalPages}</span>
                  <button type="button" aria-label="Page suivante" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="acc-icon">
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
              <div className="p-4 border-b border-neutral-200 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-emerald-800">Import terminé avec succès</p>
                  <p className="text-xs text-emerald-700 mt-1">
                    {finalResult.created} compte(s) créé(s), {finalResult.renamed} renommé(s), {finalResult.unchanged} inchangé(s).
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-4 border-b border-neutral-200 flex items-start gap-3">
                <XCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-red-800">Import échoué</p>
                  <p className="text-xs text-red-700 mt-1">{finalResult.error_count} erreur(s) détectée(s). Aucune modification n'a été appliquée.</p>
                </div>
              </div>
            )}
          </div>
        )}
</section>}
    </>
  );
}

function Stat({ label, value, error = false }: { label: string; value: number; error?: boolean }) {
  return <div>
    <span>{label}</span>
    <strong className={error && value > 0 ? 'text-red-700' : undefined}>{value.toLocaleString('fr-FR')}</strong>
  </div>;
}
