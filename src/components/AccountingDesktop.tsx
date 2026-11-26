import {useEffect,useRef,useState,useCallback,type RefObject} from 'react';
import {WindowManagerProvider,useWindowManager} from '../context/WindowManagerContext';
import {DesktopWindow} from './DesktopWindow';
import {BookOpen,LayoutGrid,Minus,Check,X} from './Icons';
import {Accounting} from '../pages/Accounting';
import {AccountingWindowId as WindowId,AccountingWorkContext,type AccountingPieceRequest} from '../context/AccountingWindowContext';
import {AccountingPiece} from './AccountingPiece';
import {AccountingAccountStatement} from './AccountingAccountStatement';
import {useApp} from '../context/AppContext';
import {usePermissions} from '../lib/permissions';
import type {Route} from './Shell';
import './accounting-desktop.css';
const sections={
 acc_entry:['entry','Saisie des écritures'],acc_plan:['plan','Plan comptable'],acc_journals:['journals','Journaux comptables'],
 acc_balance:['balance','Balance générale'],acc_grandlivre:['grandlivre','Grand livre'],acc_tiers:['tiers','Balance des tiers'],
 acc_search:['search','Recherche des écritures'],acc_statement:['statement','Interrogation et lettrage'],acc_bank:['bank','Rapprochement bancaire'],
 acc_vat:['vat','Situation de TVA'],acc_cloture:['cloture','Clôtures mensuelles'],acc_fiscal:['fiscal','Exercices et RAN'],acc_financial:['financial','États financiers']
} as const;
type WorkRoute=keyof typeof sections;
const isWork=(r:string):r is WorkRoute=>Object.prototype.hasOwnProperty.call(sections,r);
type Props={route:Route;onNavigate:(r:Route)=>void;canAccess:(r:Route)=>boolean};
export function AccountingDesktop(props:Props){
 const area=useRef<HTMLDivElement>(null);
 const getArea=useCallback(()=>({x:0,y:0,w:Math.max(1,area.current?.clientWidth??900),h:Math.max(1,area.current?.clientHeight??600)}),[]);
 return <WindowManagerProvider getArea={getArea}><Workspace {...props} area={area}/></WindowManagerProvider>;
}
type Work={id:string;title:string;kind:'section';route:WorkRoute}|{id:string;title:string;kind:'piece';request:AccountingPieceRequest}|{id:string;title:string;kind:'account';code:string};
function Workspace({route,onNavigate,canAccess,area}:Props&{area:RefObject<HTMLDivElement>}){
 const wm=useWindowManager();const {tenant}=useApp();const {can}=usePermissions();
 const [open,setOpen]=useState<Work[]>([]);
 const [active,setActive]=useState<string|null>(null);
 const [revision,setRevision]=useState(0);
 const allowed=(w:Work)=>canAccess(w.kind==='section'?w.route:w.kind==='account'?'acc_statement':'acc_journals');
 const openRoute=useCallback((r:Route)=>{
  if(r==='acc_overview'){wm.minimizeAll();setActive(null);return;}
  if(!isWork(r)||!canAccess(r))return;
  setOpen(p=>p.some(w=>w.id===r)?p:[...p,{id:r,kind:'section',route:r,title:sections[r][1]}]);
  wm.restore(r);setActive(r);
 },[wm.restore,wm.minimizeAll,canAccess]);
 useEffect(()=>{openRoute(route);},[route]);
 useEffect(()=>{
  const handler=(e:Event)=>{const r=(e as CustomEvent<{route:Route}>).detail?.route;if(r)openRoute(r);};
  window.addEventListener('waarwi:accounting-open-window',handler);
  return()=>window.removeEventListener('waarwi:accounting-open-window',handler);
 },[openRoute]);
 useEffect(()=>{setOpen(p=>{const next=p.filter(allowed);return next.length===p.length?p:next;});},[canAccess]);
 const navigate=(r:string)=>{if(r==='acc_overview'||isWork(r)){openRoute(r);onNavigate(r as Route);}};
 const openPiece=(request:AccountingPieceRequest)=>{
  if(!canAccess('acc_journals')||!request.entryNumber)return;
  const id='piece:'+request.entryNumber;
  setOpen(p=>{const old=p.find(w=>w.id===id);if(old?.kind==='piece')return request.reverse&&!old.request.reverse?p.map(w=>w.id===id?{...old,request:{...old.request,reverse:true}}:w):p;return [...p,{id,kind:'piece',title:'Pièce '+request.entryNumber,request}];});
  wm.restore(id);setActive(id);
 };
 const openAccount=(code:string)=>{
  if(!canAccess('acc_statement')||!code)return;const id='account:'+code;
  setOpen(p=>p.some(w=>w.id===id)?p:[...p,{id,kind:'account',title:'Compte '+code,code}]);wm.restore(id);setActive(id);
 };
 const activate=(w:Work)=>{if(!allowed(w))return;setActive(w.id);wm.restore(w.id);if(w.kind==='section'&&route!==w.route)onNavigate(w.route);};
 const nextWindow=(id:string)=>{
  const next=wm.windows.filter(w=>w.id!==id&&!w.minimized).sort((a,b)=>b.zIndex-a.zIndex).map(w=>open.find(o=>o.id===w.id)).find((w):w is Work=>!!w&&allowed(w));
  if(next)activate(next);else{setActive(null);onNavigate('acc_overview');}
 };
 const close=(w:Work)=>{
  if(!window.dispatchEvent(new CustomEvent('waarwi:accounting-before-navigate',{cancelable:true,detail:{windowId:w.id}})))return;
  setOpen(p=>p.filter(x=>x.id!==w.id));
  if(active===w.id)nextWindow(w.id);
 };
 const minimize=(w:Work)=>{wm.minimize(w.id);if(active===w.id)nextWindow(w.id);};
 const visible=wm.windows.filter(w=>!w.minimized);
 const selected=active&&visible.some(w=>w.id===active)?active:(visible.slice().sort((a,b)=>b.zIndex-a.zIndex)[0]?.id??null);
 const tilePossible=visible.length>=2&&visible.length<=4&&wm.getArea().w>=680&&wm.getArea().h>=(visible.length>2?380:190);
 const tile=()=>{if(tilePossible)wm.tileVisibleWindows();};
 const cascade=()=>{const a=wm.getArea();visible.slice().sort((x,y)=>x.zIndex-y.zIndex).forEach((w,i)=>{const offset=16+(i%6)*22;wm.setMaximized(w.id,false);wm.updateRect(w.id,{x:Math.min(offset,Math.max(0,a.w-320)),y:Math.min(offset,Math.max(0,a.h-170)),w:Math.min(1100,Math.max(1,a.w-offset-18)),h:Math.min(730,Math.max(1,a.h-offset-18))});});};
 const closeAll=()=>{if(!window.dispatchEvent(new CustomEvent('waarwi:accounting-before-navigate',{cancelable:true,detail:{}})))return;setOpen([]);setActive(null);onNavigate('acc_overview');};
 useEffect(()=>{const h=(e:Event)=>{switch((e as CustomEvent<{action:string}>).detail?.action){case 'home':navigate('acc_overview');break;case 'tile':tile();break;case 'cascade':cascade();break;case 'closeAll':closeAll();break;}};window.addEventListener('waarwi:accounting-window-action',h);return()=>window.removeEventListener('waarwi:accounting-window-action',h);});
 return <AccountingWorkContext.Provider value={{openPiece,openAccount,revision}}><section className="acc-desktop" aria-label="Bureau comptable">
  <div className="acc-desktop-area" ref={area}>
   <div className="acc-desktop-home"><Accounting section="overview" onNavigate={navigate}/></div>
   {open.filter(allowed).map((w,index)=>{
    const a=wm.getArea();const offset=18+(index%5)*22;const id=w.id;
    return <DesktopWindow key={id} id={id} title={w.title} icon={<BookOpen size={16}/>} contained active={selected===id} onActivate={()=>{setActive(id);if(w.kind==='section'&&route!==w.route)onNavigate(w.route);}} minW={320} minH={170} initialRect={{x:Math.min(offset,Math.max(0,a.w-400)),y:Math.min(offset,Math.max(0,a.h-270)),w:Math.min(w.kind==='piece'?850:1150,Math.max(1,a.w-offset-22)),h:Math.min(760,Math.max(1,a.h-offset-22))}} onClose={()=>close(w)} onMinimize={()=>minimize(w)}>
      <WindowId.Provider value={id}><div className="acc-window-content">{w.kind==='section'?<Accounting section={sections[w.route][0]} inWindow onNavigate={navigate} onExit={()=>close(w)}/>:w.kind==='piece'?<AccountingPiece request={w.request} onPosted={()=>setRevision(v=>v+1)}/>:tenant&&<div className="accounting-workspace"><AccountingAccountStatement tenantId={tenant.id} initialAccount={w.code} canManage={can('manage_accounting')} refreshRevision={revision} onView={r=>openPiece({entryId:r.entry_id,entryNumber:r.entry_number})}/></div>}</div></WindowId.Provider>
    </DesktopWindow>;
   })}
  </div>
  <div className="acc-desktop-taskbar" aria-label="Fenêtres ouvertes">
   <button type="button" className="acc-task-action" title="Afficher le bureau comptable" onClick={()=>navigate('acc_overview')}><BookOpen size={16}/><span>Bureau</span></button>
   <div className="acc-desktop-tasks">{open.filter(allowed).map(o=>{const w=wm.windows.find(w=>w.id===o.id);return <div className="acc-task" key={o.id} data-active={selected===o.id&&!w?.minimized}><button type="button" title={o.title} onClick={()=>activate(o)}>{w?.minimized?<Minus size={14}/>:selected===o.id?<Check size={14}/>:<BookOpen size={14}/>}<span>{o.title}</span></button><button type="button" aria-label={'Fermer '+o.title} onClick={()=>close(o)}><X size={13}/></button></div>;})}</div>
   {open.length>0&&<><button type="button" className="acc-task-action acc-tile-control" disabled={!tilePossible} title="Répartir les fenêtres" aria-label="Répartir les fenêtres" onClick={tile}><LayoutGrid size={16}/></button><button type="button" className="acc-task-action" title="Fermer toutes les fenêtres" aria-label="Fermer toutes les fenêtres" onClick={closeAll}><X size={16}/></button></>}
  </div>
 </section></AccountingWorkContext.Provider>;
}
