import {useEffect,useRef,useState,useCallback,type RefObject} from 'react';
import {WindowManagerProvider,useWindowManager} from '../context/WindowManagerContext';
import {DesktopWindow} from './DesktopWindow';
import {BookOpen,LayoutGrid,Minus,Check,X} from './Icons';
import {Accounting} from '../pages/Accounting';
import {AccountingWindowId as WindowId} from '../context/AccountingWindowContext';
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
function Workspace({route,onNavigate,canAccess,area}:Props&{area:RefObject<HTMLDivElement>}){
 const wm=useWindowManager();
 const [open,setOpen]=useState<WorkRoute[]>([]);
 const [active,setActive]=useState<WorkRoute|null>(null);
 const openRoute=useCallback((r:Route)=>{
  if(r==='acc_overview'){wm.minimizeAll();setActive(null);return;}
  if(!isWork(r)||!canAccess(r))return;
  setOpen(p=>p.includes(r)?p:[...p,r]);
  wm.restore(r);setActive(r);
 },[wm.restore,wm.minimizeAll,canAccess]);
 useEffect(()=>{openRoute(route);},[route]);
 useEffect(()=>{
  const handler=(e:Event)=>{const r=(e as CustomEvent<{route:Route}>).detail?.route;if(r)openRoute(r);};
  window.addEventListener('waarwi:accounting-open-window',handler);
  return()=>window.removeEventListener('waarwi:accounting-open-window',handler);
 },[openRoute]);
 // Remove revoked screens, even when minimized.
 useEffect(()=>{setOpen(p=>{const next=p.filter(canAccess);return next.length===p.length?p:next;});if(active&&!canAccess(active))setActive(null);},[canAccess,active]);
 const navigate=(r:string)=>{if(r==='acc_overview'||isWork(r)){openRoute(r);onNavigate(r as Route);}};
 const activate=(r:WorkRoute)=>{if(!canAccess(r))return;setActive(r);wm.restore(r);if(route!==r)onNavigate(r);};
 const close=(r:WorkRoute)=>{
  if(!window.dispatchEvent(new CustomEvent('waarwi:accounting-before-navigate',{cancelable:true,detail:{windowId:r}})))return;
  setOpen(p=>p.filter(x=>x!==r));
  if(active===r||route===r){const next=wm.windows.filter(w=>w.id!==r&&!w.minimized&&isWork(w.id)&&canAccess(w.id)).sort((a,b)=>b.zIndex-a.zIndex)[0];if(next&&isWork(next.id))activate(next.id);else{setActive(null);onNavigate('acc_overview');}}
 };
 const minimize=(r:WorkRoute)=>{wm.minimize(r);if(active===r||route===r){const next=wm.windows.filter(w=>w.id!==r&&!w.minimized&&isWork(w.id)&&canAccess(w.id)).sort((a,b)=>b.zIndex-a.zIndex)[0];if(next&&isWork(next.id))activate(next.id);else{setActive(null);onNavigate('acc_overview');}}};
 const visible=wm.windows.filter(w=>!w.minimized);
 const selected=active&&visible.some(w=>w.id===active)?active:(visible.slice().sort((a,b)=>b.zIndex-a.zIndex)[0]?.id??null);
 const tile=()=>{wm.tileVisibleWindows();};
 const closeAll=()=>{if(!window.dispatchEvent(new CustomEvent('waarwi:accounting-before-navigate',{cancelable:true,detail:{}})))return;setOpen([]);setActive(null);onNavigate('acc_overview');};
 return <section className="acc-desktop" aria-label="Bureau comptable">
  <div className="acc-desktop-area" ref={area}>
   <div className="acc-desktop-home"><Accounting section="overview" onNavigate={navigate}/></div>
   {open.filter(canAccess).map((r,index)=>{
    const [section,title]=sections[r];const a=wm.getArea();const offset=18+(index%5)*22;
    return <DesktopWindow key={r} id={r} title={title} icon={<BookOpen size={16}/>} contained active={selected===r} onActivate={()=>{setActive(r);if(route!==r)onNavigate(r);}} minW={400} minH={270} initialRect={{x:Math.min(offset,Math.max(0,a.w-400)),y:Math.min(offset,Math.max(0,a.h-270)),w:Math.min(1150,Math.max(1,a.w-offset-22)),h:Math.min(760,Math.max(1,a.h-offset-22))}} onClose={()=>close(r)} onMinimize={()=>minimize(r)}>
      <WindowId.Provider value={r}><div className="acc-window-content"><Accounting section={section} inWindow onNavigate={navigate} onExit={()=>close(r)}/></div></WindowId.Provider>
    </DesktopWindow>;
   })}
  </div>
  <div className="acc-desktop-taskbar" aria-label="Fenêtres ouvertes">
   <button type="button" className="acc-task-action" title="Afficher le bureau comptable" onClick={()=>navigate('acc_overview')}><BookOpen size={16}/><span>Bureau</span></button>
   <div className="acc-desktop-tasks">{open.filter(canAccess).map(r=>{const w=wm.windows.find(w=>w.id===r);return <div className="acc-task" key={r} data-active={selected===r&&!w?.minimized}><button type="button" title={sections[r][1]} onClick={()=>activate(r)}>{w?.minimized?<Minus size={14}/>:selected===r?<Check size={14}/>:<BookOpen size={14}/>}<span>{sections[r][1]}</span></button><button type="button" aria-label={'Fermer '+sections[r][1]} onClick={()=>close(r)}><X size={13}/></button></div>;})}</div>
   {open.length>0&&<><button type="button" className="acc-task-action acc-tile-control" disabled={visible.length<2} title="Répartir les fenêtres" aria-label="Répartir les fenêtres" onClick={tile}><LayoutGrid size={16}/></button><button type="button" className="acc-task-action" title="Fermer toutes les fenêtres" aria-label="Fermer toutes les fenêtres" onClick={closeAll}><X size={16}/></button></>}
  </div>
 </section>;
}
