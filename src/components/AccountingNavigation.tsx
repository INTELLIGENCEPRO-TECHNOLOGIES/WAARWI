import {useEffect,useRef,useState,type KeyboardEvent,type ComponentType} from 'react';
import {ArrowLeft,BookOpen,ChevronDown,ChevronRight,Check,LayoutDashboard,Plus,FileText,Search,ArrowRightLeft,Lock,TrendingUp,Users,Menu} from './Icons';
import type {Route} from './Shell';
import './accounting-navigation.css';

type Leaf={route:Route;label:string;icon:ComponentType<{size?:number;className?:string}>};
type Group={label:string;items:(Leaf|{label:string;children:Leaf[]})[]};
const groups:Group[]=[
 {label:'Fichier',items:[{route:'acc_overview',label:'Accueil comptable',icon:LayoutDashboard}]},
 {label:'Structure',items:[{route:'acc_plan',label:'Plan comptable',icon:BookOpen}]},
 {label:'Traitement',items:[
  {label:'Écritures',children:[{route:'acc_entry',label:'Saisie des écritures',icon:Plus},{route:'acc_journals',label:'Journaux comptables',icon:FileText}]},
  {label:'Consultation',children:[{route:'acc_search',label:'Recherche des écritures',icon:Search},{route:'acc_statement',label:'Interrogation et lettrage',icon:Search}]},
  {route:'acc_bank',label:'Rapprochement bancaire',icon:ArrowRightLeft},
  {label:'Clôtures',children:[{route:'acc_cloture',label:'Clôtures mensuelles',icon:Lock},{route:'acc_fiscal',label:'Exercices et reports à nouveau',icon:Lock}]}
 ]},
 {label:'État',items:[
  {route:'acc_balance',label:'Balance générale',icon:TrendingUp},
  {route:'acc_grandlivre',label:'Grand livre',icon:BookOpen},
  {route:'acc_tiers',label:'Balance des tiers',icon:Users},
  {route:'acc_vat',label:'Situation de TVA',icon:FileText},
  {route:'acc_financial',label:'États financiers',icon:FileText}
 ]}
];
const leaves=groups.flatMap(g=>g.items.flatMap(i=>'children' in i?i.children:[i]));
export function AccountingNavigation({route,onNavigate,canAccess}:{route:Route;onNavigate:(r:Route)=>void;canAccess:(r:Route)=>boolean}){
 const [opened,setOpened]=useState<string|null>(null),[sub,setSub]=useState<string|null>(null),[mobile,setMobile]=useState(false);
 const root=useRef<HTMLElement>(null);
 const previousTrigger=useRef<HTMLButtonElement|null>(null);
 const allowed=groups.map(g=>({...g,items:g.items.flatMap<Group['items'][number]>(i=>'children' in i?(i.children.some(x=>canAccess(x.route))?[{...i,children:i.children.filter(x=>canAccess(x.route))}]:[]):canAccess(i.route)?[i]:[])})).filter(g=>g.items.length);
 const title=leaves.find(l=>l.route===route)?.label??'Comptabilité';
 const exit=()=>onNavigate((['dashboard','pos','articles','billing','tiers','sales'] as Route[]).find(canAccess)??'dashboard');
 const close=()=>{setOpened(null);setSub(null);setMobile(false);};
 useEffect(()=>{close();},[route]);
 useEffect(()=>{const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))close();};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[]);
 const select=(r:Route)=>{if(canAccess(r)){close();onNavigate(r);}};
 const activate=(label:string,button:HTMLButtonElement)=>{previousTrigger.current=button;setOpened(p=>p===label?null:label);setSub(null);};
 const keyboard=(e:KeyboardEvent<HTMLElement>)=>{
  if(e.key==='Escape'){e.preventDefault();if(sub){setSub(null);(root.current?.querySelector('[data-acc-sub="'+sub+'"]') as HTMLButtonElement|null)?.focus();}else{close();previousTrigger.current?.focus();}return;}
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){const target=e.target as HTMLElement;const parent=target.closest('[data-acc-level]');if(!parent)return;const buttons=Array.from(parent.querySelectorAll<HTMLButtonElement>(':scope > button,:scope > div > button')).filter(b=>b.offsetParent!==null);const index=buttons.indexOf(target as HTMLButtonElement);if(index>=0&&buttons.length){e.preventDefault();buttons[(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}}
 };
 const leaf=(i:Leaf)=>{const Icon=i.icon;return <button type="button" key={i.route} aria-current={route===i.route?'page':undefined} className="acc-nav-leaf" onClick={()=>select(i.route)}><Icon size={16}/><span>{i.label}</span>{route===i.route&&<Check size={15} className="acc-nav-tick"/>}</button>;};
 const entries=(g:Group,small=false)=><div className={small?'acc-nav-mobile-items':'acc-nav-dropdown'} data-acc-level>
  {g.items.map(i=>'children' in i?<div key={i.label} className="acc-nav-sub" onMouseEnter={()=>{if(!small)setSub(i.label);}} onMouseLeave={()=>{if(!small)setSub(null);}}><button type="button" data-acc-sub={i.label} className="acc-nav-leaf" aria-expanded={sub===i.label} onClick={()=>setSub(p=>small&&p===i.label?null:i.label)}><span>{i.label}</span><ChevronRight size={15} className={small&&sub===i.label?'acc-nav-rotate':''}/></button>{sub===i.label&&<div className={small?'acc-nav-mobile-sub':'acc-nav-flyout'} data-acc-level>{i.children.map(leaf)}</div>}</div>:leaf(i))}
 </div>;
 return <nav ref={root} className="acc-navigation" aria-label="Menu de la comptabilité" onKeyDown={keyboard}>
  <div className="acc-nav-desktop">
   <button type="button" className="acc-nav-home" title="Accueil comptable" aria-label="Accueil comptable" onClick={()=>select('acc_overview')}><BookOpen size={18}/><strong>Comptabilité</strong></button>
   <div className="acc-nav-groups" data-acc-level>{allowed.map(g=><div className="acc-nav-group" key={g.label} onMouseEnter={()=>{if(opened&&opened!==g.label){setOpened(g.label);setSub(null);}}}><button type="button" className="acc-nav-trigger" data-current={g.items.some(i=>'children' in i?i.children.some(l=>l.route===route):i.route===route)} aria-expanded={opened===g.label} onClick={e=>activate(g.label,e.currentTarget)}>{g.label}<ChevronDown size={13}/></button>{opened===g.label&&entries(g)}</div>)}</div>
   <span className="acc-nav-current">{title}</span>
   <button type="button" className="acc-nav-exit" onClick={exit} title="Retour à Waarwi"><ArrowLeft size={16}/>Retour à Waarwi</button>
  </div>
  <div className="acc-nav-mobile">
   <button type="button" className="acc-nav-trigger" aria-expanded={mobile} onClick={e=>{previousTrigger.current=e.currentTarget;setMobile(v=>!v);setOpened(null);setSub(null);}}><Menu size={17}/>Comptabilité<ChevronDown size={14}/></button>
   <span className="acc-nav-current">{title}</span>
   <button type="button" className="acc-nav-exit" aria-label="Retour à Waarwi" title="Retour à Waarwi" onClick={exit}><ArrowLeft size={17}/></button>
   {mobile&&<div className="acc-nav-mobile-panel" data-acc-level>{allowed.map(g=><div key={g.label}><button type="button" className="acc-nav-leaf" aria-expanded={opened===g.label} onClick={()=>{setOpened(p=>p===g.label?null:g.label);setSub(null);}}><strong>{g.label}</strong><ChevronRight size={15} className={opened===g.label?'acc-nav-rotate':''}/></button>{opened===g.label&&entries(g,true)}</div>)}</div>}
  </div>
 </nav>;
}
