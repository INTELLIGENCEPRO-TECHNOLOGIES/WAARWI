import {useEffect,useLayoutEffect,useRef,useState,type KeyboardEvent,type ComponentType} from 'react';
import {ArrowLeft,BookOpen,ChevronDown,ChevronRight,Check,LayoutDashboard,Plus,FileText,Search,ArrowRightLeft,Lock,TrendingUp,Users,Menu} from './Icons';
import type {Route} from './Shell';
import './accounting-navigation.css';

type Leaf={route:Route;label:string;icon:ComponentType<{size?:number;className?:string}>};
type Group={label:string;items:(Leaf|{label:string;children:Leaf[]})[]};
const groups:Group[]=[
 {label:'Fichier',items:[{route:'acc_overview',label:'Accueil comptable',icon:LayoutDashboard}]},
 {label:'Structure',items:[{route:'acc_plan',label:'Plan comptable',icon:BookOpen},{route:'acc_journal_settings',label:'Codes journaux',icon:FileText}]},
 {label:'Traitement',items:[
  {label:'Écritures',children:[{route:'acc_entry',label:'Saisie des écritures',icon:Plus},{route:'acc_journals',label:'Journaux comptables',icon:FileText}]},
  {label:'Consultation',children:[{route:'acc_search',label:'Recherche des écritures',icon:Search},{route:'acc_statement',label:'Interrogation et lettrage',icon:Search}]},
  {route:'acc_bank',label:'Rapprochement bancaire',icon:ArrowRightLeft},
  {route:'acc_revision',label:'Révision comptable',icon:FileText},
  {route:'acc_assets',label:'Immobilisations et amortissements',icon:BookOpen},
  {route:'acc_analytics',label:'Analytique et budgets',icon:TrendingUp},
  {label:'Clôtures',children:[{route:'acc_cloture',label:'Clôtures mensuelles',icon:Lock},{route:'acc_fiscal',label:'Exercices et reports à nouveau',icon:Lock}]}
 ]},
 {label:'État',items:[
  {route:'acc_balance',label:'Balance générale',icon:TrendingUp},
  {route:'acc_grandlivre',label:'Grand livre',icon:BookOpen},
  {route:'acc_tiers',label:'Balance des tiers',icon:Users},{route:'acc_aging',label:'Balance âgée et échéances',icon:FileText},
  {route:'acc_vat',label:'Situation de TVA',icon:FileText},
  {route:'acc_financial',label:'États financiers',icon:FileText}
 ]}
];
const leaves=groups.flatMap(g=>g.items.flatMap(i=>'children' in i?i.children:[i]));
export function AccountingNavigation({route,onNavigate,canAccess}:{route:Route;onNavigate:(r:Route)=>void;canAccess:(r:Route)=>boolean}){
 const [opened,setOpened]=useState<string|null>(null),[sub,setSub]=useState<string|null>(null),[mobile,setMobile]=useState(false);
 const root=useRef<HTMLElement>(null);
 const previousTrigger=useRef<HTMLButtonElement|null>(null);
 const flyout=useRef<HTMLDivElement>(null);
 const [opensLeft,setOpensLeft]=useState(false);
 useLayoutEffect(()=>{const panel=flyout.current;if(!panel)return;const row=panel.parentElement?.getBoundingClientRect();if(!row)return;const measure=()=>{const b=panel.parentElement?.getBoundingClientRect();if(!b)return;const left=window.innerWidth-b.right<panel.offsetWidth+8&&b.left>=panel.offsetWidth+8;setOpensLeft(left);const top=b.top;panel.style.setProperty('--acc-flyout-y',Math.min(0,window.innerHeight-8-top-panel.offsetHeight)+'px');};measure();window.addEventListener('resize',measure);return()=>window.removeEventListener('resize',measure);},[opened,sub]);
 const allowed=groups.map(g=>({...g,items:g.items.flatMap<Group['items'][number]>(i=>'children' in i?(i.children.some(x=>canAccess(x.route))?[{...i,children:i.children.filter(x=>canAccess(x.route))}]:[]):canAccess(i.route)?[i]:[])})).filter(g=>g.items.length);
 const title=leaves.find(l=>l.route===route)?.label??'Comptabilité';
 const exit=()=>onNavigate((['dashboard','pos','articles','billing','tiers','sales'] as Route[]).find(canAccess)??'dashboard');
 const close=()=>{setOpened(null);setSub(null);setMobile(false);};
 useEffect(()=>{close();},[route]);
 useEffect(()=>{const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))close();};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[]);
 const windowAction=(action:string)=>{close();window.dispatchEvent(new CustomEvent('waarwi:accounting-window-action',{detail:{action}}));};
 const windowEntries=(small=false)=><div className={small?'acc-nav-mobile-items':'acc-nav-dropdown'} data-acc-level>{[{action:'home',label:'Afficher le bureau / réduire tout'},{action:'cascade',label:'Cascade'},{action:'tile',label:'Mosaïque'},{action:'closeAll',label:'Fermer toutes les fenêtres'}].filter(i=>!small||i.action==='home'||i.action==='closeAll').map(i=><button type="button" key={i.action} className="acc-nav-leaf" onClick={()=>windowAction(i.action)}><span>{i.label}</span></button>)}</div>;
 const select=(r:Route)=>{if(canAccess(r)){close();onNavigate(r);}};
 const activate=(label:string,button:HTMLButtonElement)=>{previousTrigger.current=button;setOpened(p=>p===label?null:label);setSub(null);};
 const keyboard=(e:KeyboardEvent<HTMLElement>)=>{
  const target=e.target as HTMLElement;
  if(e.key==='ArrowRight'&&target.dataset.accSub){e.preventDefault();setSub(target.dataset.accSub);requestAnimationFrame(()=>{flyout.current?.querySelector('button')?.focus();});return;}
  if(e.key==='ArrowLeft'&&sub&&target.closest('.acc-nav-flyout')){e.preventDefault();const parent=target.closest('.acc-nav-sub')?.querySelector<HTMLButtonElement>('[data-acc-sub]');setSub(null);parent?.focus();return;}
  if(e.key==='ArrowDown'&&target.classList.contains('acc-nav-trigger')&&target.closest('.acc-nav-group')){e.preventDefault();const label=target.textContent?.trim()??'';setOpened(label);setSub(null);requestAnimationFrame(()=>{target.parentElement?.querySelector<HTMLButtonElement>('.acc-nav-dropdown button')?.focus();});return;}
  if(e.key==='Escape'){e.preventDefault();if(sub){setSub(null);(root.current?.querySelector('[data-acc-sub="'+sub+'"]') as HTMLButtonElement|null)?.focus();}else{close();previousTrigger.current?.focus();}return;}
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){const target=e.target as HTMLElement;const parent=target.closest('[data-acc-level]');if(!parent)return;const buttons=Array.from(parent.querySelectorAll<HTMLButtonElement>(':scope > button,:scope > div > button')).filter(b=>b.offsetParent!==null);const index=buttons.indexOf(target as HTMLButtonElement);if(index>=0&&buttons.length){e.preventDefault();buttons[(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}}
 };
 const leaf=(i:Leaf,small=false,child=false)=>{const Icon=i.icon;return <button type="button" key={i.route} aria-current={route===i.route?'page':undefined} className="acc-nav-leaf" onMouseEnter={()=>{if(!small&&!child)setSub(null);}} onClick={()=>select(i.route)}><Icon size={16} className="acc-nav-item-icon"/><span>{i.label}</span>{route===i.route&&<Check size={15} className="acc-nav-tick"/>}</button>;};
 const entries=(g:Group,small=false)=><div className={small?'acc-nav-mobile-items':'acc-nav-dropdown'} data-acc-level>
  {g.items.map(i=>'children' in i?<div key={i.label} className="acc-nav-sub" onMouseEnter={()=>{if(!small)setSub(i.label);}}><button type="button" data-acc-sub={i.label} className="acc-nav-leaf" aria-expanded={sub===i.label} onClick={()=>setSub(p=>small&&p===i.label?null:i.label)}><span>{i.label}</span><ChevronRight size={13} className={small&&sub===i.label?'acc-nav-rotate':''}/></button>{sub===i.label&&<div ref={small?undefined:flyout} className={small?'acc-nav-mobile-sub':'acc-nav-flyout'+(opensLeft?' acc-nav-flyout-left':'')} data-acc-level>{i.children.map(x=>leaf(x,small,true))}</div>}</div>:leaf(i,small))}
 </div>;
 return <nav ref={root} className="acc-navigation" aria-label="Menu de la comptabilité" onKeyDown={keyboard}>
  <div className="acc-nav-desktop">
   <button type="button" className="acc-nav-home" title="Accueil comptable" aria-label="Accueil comptable" onClick={()=>select('acc_overview')}><BookOpen size={18}/><strong>Comptabilité</strong></button>
   <div className="acc-nav-groups" data-acc-level>{allowed.map(g=><div className="acc-nav-group" key={g.label} onMouseEnter={()=>{if(opened&&opened!==g.label){setOpened(g.label);setSub(null);}}}><button type="button" className="acc-nav-trigger" data-current={g.items.some(i=>'children' in i?i.children.some(l=>l.route===route):i.route===route)} aria-expanded={opened===g.label} onClick={e=>activate(g.label,e.currentTarget)}>{g.label}</button>{opened===g.label&&entries(g)}</div>)}<div className="acc-nav-group" onMouseEnter={()=>{if(opened&&opened!=='Fenêtre'){setOpened('Fenêtre');setSub(null);}}}><button type="button" className="acc-nav-trigger" aria-expanded={opened==='Fenêtre'} onClick={e=>activate('Fenêtre',e.currentTarget)}>Fenêtre</button>{opened==='Fenêtre'&&windowEntries()}</div></div>
   <span className="acc-nav-current">{title}</span>
   <button type="button" className="acc-nav-exit" onClick={exit} title="Retour à Waarwi"><ArrowLeft size={16}/>Retour à Waarwi</button>
  </div>
  <div className="acc-nav-mobile">
   <button type="button" className="acc-nav-trigger" aria-expanded={mobile} onClick={e=>{previousTrigger.current=e.currentTarget;setMobile(v=>!v);setOpened(null);setSub(null);}}><Menu size={17}/>Comptabilité<ChevronDown size={14}/></button>
   <span className="acc-nav-current">{title}</span>
   <button type="button" className="acc-nav-exit" aria-label="Retour à Waarwi" title="Retour à Waarwi" onClick={exit}><ArrowLeft size={17}/></button>
   {mobile&&<div className="acc-nav-mobile-panel" data-acc-level>{allowed.map(g=><div key={g.label}><button type="button" className="acc-nav-leaf" aria-expanded={opened===g.label} onClick={()=>{setOpened(p=>p===g.label?null:g.label);setSub(null);}}><strong>{g.label}</strong><ChevronRight size={15} className={opened===g.label?'acc-nav-rotate':''}/></button>{opened===g.label&&entries(g,true)}</div>)}<div><button type="button" className="acc-nav-leaf" aria-expanded={opened==='Fenêtre'} onClick={()=>{setOpened(p=>p==='Fenêtre'?null:'Fenêtre');setSub(null);}}><strong>Fenêtre</strong><ChevronRight size={15}/></button>{opened==='Fenêtre'&&windowEntries(true)}</div></div>}
  </div>
 </nav>;
}
