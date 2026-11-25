import {useEffect,useRef,useState} from 'react';
import {supabase} from '../lib/supabase';
import {AccountingTable} from './AccountingWorkspace';
import {Save,Download,RefreshCw} from './Icons';
import type {FinancialSnapshot,FinancialStatements} from '../lib/accountingFinancialStatements.mjs';
import {assetLabels,flowLabels,flowInputKeys,annexLabels,detailedAssets,suggestIndirect,indirectFlow} from '../lib/accountingStatutoryWorking.mjs';
type Workpaper={revision:number;flow_inputs:Record<string,number>;flow_justifications:Record<string,string>;annexes:Record<string,string>};
type Props={tenantId:string;year:number;snapshot:FinancialSnapshot;report:FinancialStatements;previous?:{snapshot:FinancialSnapshot;report:FinancialStatements}|null;canManage:boolean};
const money=(n:number|null|undefined)=>n===null||n===undefined?'—':new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(n)+' FCFA';
const msg=(e:unknown)=>e&&typeof e==='object'&&'message' in e?String(e.message):'Opération impossible.';
const parse=(v:string)=>{const s=v.trim().replace(/\s/g,'').replace(',','.');if(!/^-?\d+(\.\d{1,2})?$/.test(s))throw Error('Montant invalide : '+v);return Number(s);};
export function AccountingStatutoryWorking({tenantId,year,snapshot,report,previous,canManage}:Props){
 const [tab,setTab]=useState<'assets'|'flow'|'annexes'>('assets');
 const [inputs,setInputs]=useState<Record<string,string>>({});
 const [why,setWhy]=useState<Record<string,string>>({});
 const [annexes,setAnnexes]=useState<Record<string,string>>({});
 const [revision,setRevision]=useState(0);
 const [reload,setReload]=useState(0);
 const [loading,setLoading]=useState(true);
 const [loaded,setLoaded]=useState(false);
 const [busy,setBusy]=useState(false);
 const [dirty,setDirty]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const lock=useRef(false);
 useEffect(()=>{let live=true;setLoading(true);setLoaded(false);setError('');setNotice('');setDirty(false);
 void(async()=>{try{const {data,error:err}=await supabase.from('accounting_financial_workpapers').select('revision,flow_inputs,flow_justifications,annexes').eq('tenant_id',tenantId).eq('fiscal_year',year).maybeSingle();
 if(err)throw err;const w=data as Workpaper|null;
 if(live){setRevision(w?.revision??0);setInputs(Object.fromEntries(Object.entries(w?.flow_inputs??{}).map(([k,v])=>[k,String(v)])));setWhy(w?.flow_justifications??{});setAnnexes(w?.annexes??{});setLoaded(true);}
 }catch(e){if(live)setError(msg(e));}finally{if(live)setLoading(false);}})();return()=>{live=false;};
 },[tenantId,year,reload]);
 const asset=detailedAssets(snapshot,report.totalAssets);
 const prior=previous?detailedAssets(previous.snapshot,previous.report.totalAssets):null;
 const proposal=suggestIndirect(snapshot);
 const editable=loaded&&!loading&&!busy&&canManage;
 let flow:ReturnType<typeof indirectFlow>|null=null;let flowError='';let parsed:Record<string,number>={};
 try{parsed=Object.fromEntries(Object.entries(inputs).filter(([,v])=>v.trim()!=='').map(([k,v])=>[k,parse(v)]));flow=indirectFlow(report.cash.opening,report.cash.closing,parsed);}catch(e){flowError=msg(e);}
 const missingReasons=Object.keys(parsed).filter(k=>!why[k]?.trim());
 const change=(k:string,v:string)=>{setInputs(p=>({...p,[k]:v}));setDirty(true);};
 const save=async()=>{if(!editable||lock.current||flowError||missingReasons.length)return;lock.current=true;setBusy(true);setError('');setNotice('');
 try{const justifications=Object.fromEntries(Object.keys(parsed).map(k=>[k,why[k].trim()]));const {data,error:err}=await supabase.rpc('save_financial_workpaper',{p_tenant_id:tenantId,p_year:year,p_expected_revision:revision,p_inputs:parsed,p_justifications:justifications,p_annexes:annexes});
 if(err)throw err;if(!data?.success)throw Error('Sauvegarde non confirmée.');setRevision(Number(data.revision));setDirty(false);setNotice('Dossier de travail enregistré.');
 }catch(e){setError(msg(e));}finally{lock.current=false;setBusy(false);}};
 const apply=()=>{setInputs(p=>{const n={...p};for(const [k,v] of Object.entries(proposal.proposed))if(!n[k]?.trim())n[k]=String(v);return n;});setDirty(true);};
 const excel=async()=>{if(busy||!loaded)return;setBusy(true);setError('');try{const X=await import('xlsx');const wb=X.utils.book_new();const add=(name:string,rows:(string|number|null)[][])=>{const ws=X.utils.aoa_to_sheet(rows);X.utils.book_append_sheet(wb,ws,name);};
 add('Actif détaillé',[['État de travail',year],['Rubrique','Brut N','Amort. et dépr. N','Net N','Net N-1'],...Object.entries(asset.rows).map(([k,r])=>[assetLabels[k],r.gross,r.impairment,r.net,prior?.rows[k]?.net??null]),['Total',asset.total.gross,asset.total.impairment,asset.total.net,prior?.total.net??null]]);
 add('Flux indirects',[['État de travail',year],['Réf.','Rubrique','Montant','Justification'],...Object.entries(flowLabels).map(([k,label])=>[k,label,flow?.values[k]??null,why[k]??'']),['Contrôle','Écart de trésorerie',flow?.gap??null],['Statut',flow?.complete&&!missingReasons.length?'Équilibré, à valider':'Incomplet']]);
 add('Notes annexes',[['Thème','Information à vérifier'],...Object.entries(annexLabels).map(([k,label])=>[label,annexes[k]??'À documenter'])]);X.writeFile(wb,'Dossier-financier-travail-'+year+'.xlsx');
 }catch(e){setError(msg(e));}finally{setBusy(false);}};
 const detailRows=[...Object.entries(asset.rows).map(([k,r])=>({key:k,label:assetLabels[k],...r,prior:prior?.rows[k]?.net??null})),{key:'total',label:'Total actif détaillé',...asset.total,prior:prior?.total.net??null}];
 return <section className="space-y-3 min-w-0">
 <div className="acc-section-head space-y-2"><h2 className="text-sm font-semibold">Dossier financier détaillé · {year}</h2><p className="text-xs text-neutral-600">États de préparation, non certifiés. Les propositions doivent être contrôlées et justifiées avant toute utilisation réglementaire.</p>
 <nav className="acc-tabs print:hidden" aria-label="Dossier financier">{([['assets','Actif brut / net'],['flow','Flux indirects'],['annexes','Notes annexes']] as const).map(([k,l])=><button type="button" key={k} className="acc-tab" aria-pressed={tab===k} onClick={()=>setTab(k)}>{l}</button>)}</nav>
 {loading&&<p className="text-xs">Chargement du dossier…</p>}{error&&<p role="alert" className="text-xs text-red-700 break-words">{error}</p>}{notice&&<p role="status" className="text-xs">{notice}</p>}
 <div className="acc-toolbar print:hidden">{canManage&&<button className="btn btn-primary" disabled={!editable||!dirty||!!flowError||missingReasons.length>0} onClick={()=>void save()}><Save size={16}/>Enregistrer le dossier</button>}<button className="btn btn-secondary" disabled={!loaded||busy||!!flowError} onClick={()=>void excel()}><Download size={16}/>Excel détaillé</button><button className="btn btn-secondary" disabled={busy} onClick={()=>{if(!dirty||window.confirm('Abandonner les modifications non enregistrées ?'))setReload(x=>x+1);}}><RefreshCw size={16}/>Actualiser</button></div>
 {dirty&&<p className="text-xs text-amber-800">Modifications non enregistrées.</p>}</div>
 {tab==='assets'&&<div className="card p-3 space-y-2"><h3 className="text-sm font-semibold">Actif détaillé</h3><p className="text-xs text-neutral-600">Ventilation par préfixes du plan comptable. Les comptes atypiques nécessitent un contrôle.</p>{asset.issues.map(x=><p key={x} className="text-xs text-red-700">{x}</p>)}
 <AccountingTable><table className="acc-financial-table"><thead><tr><th className="text-left">Rubrique (FCFA)</th><th className="text-right">Brut N</th><th className="text-right">Amort. / dépr.</th><th className="text-right">Net N</th><th className="text-right">Net N-1</th></tr></thead><tbody>{detailRows.map(r=><tr key={r.key} className={r.key==='total'?'acc-total-row':''}><td>{r.label}</td>{[r.gross,r.impairment,r.net,r.prior].map((v,i)=><td key={i} className="text-right">{v===null?'—':new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(v)}</td>)}</tr>)}</tbody></table></AccountingTable></div>}

 {tab==='flow'&&<div className="card p-3 space-y-3"><h3 className="text-sm font-semibold">Tableau par méthode indirecte · ZA à ZH</h3><p className="text-xs text-neutral-600">Les montants manquants ne sont pas remplacés par zéro. Vérifiez les non-flux, les cessions, les variations de créances et dettes et les opérations de financement. Les décaissements sont négatifs.</p>
 {proposal.notes.map(x=><p key={x} className="text-xs text-amber-800">{x}</p>)}{canManage&&<button className="btn btn-secondary print:hidden" disabled={!editable} onClick={apply}>Préremplir les rubriques simples</button>}
 {flowError&&<p role="alert" className="text-xs text-red-700">{flowError}</p>}{missingReasons.length>0&&<p className="text-xs text-amber-800">{missingReasons.length} montant(s) à justifier.</p>}
 <div className="acc-form-scroll"><div className="acc-flow-head hidden sm:grid"><span>Rubrique</span><span>Montant (FCFA)</span><span>Justification</span></div>{Object.entries(flowLabels).map(([k,l])=>flowInputKeys.includes(k)?<div key={k} className="acc-flow-row"><label className="font-medium" htmlFor={'flow-'+k}>{k} · {l}</label><input id={'flow-'+k} className="input w-full" inputMode="decimal" placeholder="À renseigner" value={inputs[k]??''} disabled={!editable} onChange={e=>change(k,e.target.value)}/><textarea className="input w-full" aria-label={'Justification '+k} placeholder="Justification / pièce" maxLength={1000} value={why[k]??''} disabled={!editable} onChange={e=>{setWhy(p=>({...p,[k]:e.target.value}));setDirty(true);}}/></div>:<div key={k} className="acc-flow-total"><span>{k} · {l}</span><span>{money(flow?.values[k])}</span></div>)}</div>
 <div className="border-t pt-2 space-y-1"><p className="text-xs">Trésorerie de référence : {money(report.cash.closing)}</p><p className="text-sm font-semibold">Écart : {money(flow?.gap)}</p><p className="text-xs">{flow?.complete&&!missingReasons.length?'Tableau équilibré et documenté, sous réserve de validation des retraitements.':'Tableau incomplet ou à contrôler.'}</p></div></div>}
 {tab==='annexes'&&<div className="card p-3 space-y-3"><h3 className="text-sm font-semibold">Dossier de notes annexes</h3><p className="text-xs text-neutral-600">Trame de collecte des informations qualitatives. Les tableaux réglementaires et pièces justificatives doivent être complétés selon l’activité de l’entreprise.</p><p className="text-xs">{Object.keys(annexLabels).filter(k=>annexes[k]?.trim()).length}/{Object.keys(annexLabels).length} thèmes renseignés</p><div className="acc-form-scroll">{Object.entries(annexLabels).map(([k,l])=><details key={k} className="acc-annex"><summary>{l}<span className="acc-status">{annexes[k]?.trim()?'Renseigné':'À documenter'}</span></summary><label className="block text-xs font-medium"><span className="sr-only">{l}</span><textarea className="input mt-1 w-full" rows={3} maxLength={10000} placeholder="À documenter ou justifier sans objet" disabled={!editable} value={annexes[k]??''} onChange={e=>{setAnnexes(p=>({...p,[k]:e.target.value}));setDirty(true);}}/></label></details>)}</div></div>}
 </section>;
}
