import {useEffect,useState} from 'react';
import {supabase} from '../lib/supabase';
import {formatDate} from '../lib/format';
import {ArrowRight,Plus,BookOpen,Scale,Search,FileText,Lock,RefreshCw} from './Icons';
type Entry={id:string;entry_number:string;entry_date:string;journal_type:string;description:string;total_debit:number;status:string};
type Data={total:number;posted:number;draft:number;recent:Entry[]};
export function AccountingOverview({tenantId,canManage,onNavigate}:{tenantId:string;canManage:boolean;onNavigate:(route:string)=>void}){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{let active=true;setData(null);setError('');void(async()=>{try{
 const base=()=>supabase.from('journal_entries').select('id',{count:'exact',head:true}).eq('tenant_id',tenantId);
 const [all,posted,draft,recent]=await Promise.all([base(),base().eq('status','posted'),base().eq('status','draft'),supabase.from('journal_entries').select('id,entry_number,entry_date,journal_type,description,total_debit,status').eq('tenant_id',tenantId).order('entry_date',{ascending:false}).order('entry_number',{ascending:false}).order('id',{ascending:false}).limit(8)]);
 const err=all.error??posted.error??draft.error??recent.error;if(err)throw err;
 if(active)setData({total:all.count??0,posted:posted.count??0,draft:draft.count??0,recent:(recent.data??[]) as Entry[]});
 }catch(e){if(active)setError(e&&typeof e==='object'&&'message' in e?String(e.message):'Impossible de charger la situation.');}})();return()=>{active=false;};},[tenantId,revision]);
 const shortcuts=[{route:'acc_journals',label:'Journaux',icon:BookOpen},{route:'acc_balance',label:'Balance générale',icon:Scale},{route:'acc_statement',label:'Interrogation des comptes',icon:Search},{route:'acc_financial',label:'États financiers',icon:FileText},{route:'acc_cloture',label:'Clôtures',icon:Lock}];
 return <section className="space-y-3">
 <div className="acc-toolbar"><span className="text-xs text-neutral-500">Situation comptable · tous exercices</span><span className="acc-spacer"/><button type="button" className="btn-secondary" onClick={()=>setRevision(n=>n+1)}><RefreshCw size={16}/>Actualiser</button>{canManage&&<button type="button" className="btn-primary" onClick={()=>onNavigate('acc_entry')}><Plus size={16}/>Nouvelle écriture</button>}</div>
 {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
 <div className="acc-summary">{[['Écritures',data?.total],['Validées',data?.posted],['Brouillons',data?.draft]].map(([label,value])=><div key={label}><span>{label}</span><strong>{value===undefined?'—':Number(value).toLocaleString('fr-FR')}</strong></div>)}</div>
 <div className="acc-overview-links"><h2 className="text-sm font-semibold">Accès directs</h2>{shortcuts.map(({route,label,icon:Icon})=><button key={route} type="button" onClick={()=>onNavigate(route)}><Icon size={17}/><span>{label}</span><ArrowRight size={15}/></button>)}</div>
 <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">Dernières écritures</h2><button type="button" className="btn-ghost text-xs" onClick={()=>onNavigate('acc_journals')}>Tous les journaux <ArrowRight size={15}/></button></div>
 <div className="acc-table-frame"><div className="acc-table-scroll"><table><thead><tr><th className="text-left">Pièce</th><th className="text-left hidden sm:table-cell">Date</th><th className="text-left">Libellé</th><th className="text-right">Débit (FCFA)</th></tr></thead><tbody>{data?.recent.map(e=><tr key={e.id}><td className="font-medium">{e.entry_number}<span className="block text-[11px] text-neutral-500">{e.journal_type}</span></td><td className="hidden sm:table-cell">{formatDate(e.entry_date)}</td><td>{e.description}<span className="block sm:hidden text-[11px] text-neutral-500">{formatDate(e.entry_date)}</span></td><td className="text-right">{Number(e.total_debit).toLocaleString('fr-FR')}</td></tr>)}{!data?.recent.length&&<tr><td colSpan={4} className="text-center text-neutral-500">{data?'Aucune écriture.':error?'Chargement indisponible.':'Chargement…'}</td></tr>}</tbody></table></div></div>
 </section>;
}
