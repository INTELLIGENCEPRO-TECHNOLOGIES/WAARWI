import {useEffect,useRef,useState,useCallback,type RefObject,type ReactNode,type ComponentProps} from 'react';
import {WindowManagerProvider,useWindowManager} from '../context/WindowManagerContext';
import {DesktopWindow} from './DesktopWindow';
import {ArrowLeft,BookOpen,LayoutGrid,Minus,MoreHorizontal,Search,X} from './Icons';
import {Accounting} from '../pages/Accounting';
import {AccountingMobile,AccountingWindowId as WindowId,AccountingWorkContext,AccountingWindowVisible,type AccountingWorkActions,type AccountingPieceRequest,useAccountingWork} from '../context/AccountingWindowContext';
import {AccountingPiece} from './AccountingPiece';
import type {EntryTemplateSource} from './AccountingTemplateWorkspace';
import {AccountingPlanIO} from './AccountingPlanIO';
import {AccountingAccountStatement} from './AccountingAccountStatement';
import {useApp} from '../context/AppContext';
import {usePermissions} from '../lib/permissions';
import type {Route} from './Shell';
import './accounting-desktop.css';
const sections={
 acc_templates:['templates','Modèles de saisie'],acc_guide:['guide','Guide de la comptabilité'],
 acc_journal_settings:['journal_settings','Codes journaux'],acc_entry:['entry','Saisie des écritures'],acc_plan:['plan','Plan comptable'],acc_journals:['journals','Journaux comptables'],
 acc_analytics:['analytics','Analytique et budgets'],acc_assets:['assets','Immobilisations et amortissements'],acc_revision:['revision','Révision comptable'],acc_aging:['aging','Balance âgée et échéances'],acc_balance:['balance','Balance générale'],acc_grandlivre:['grandlivre','Grand livre'],acc_tiers:['tiers','Balance des tiers'],
 acc_search:['search','Recherche des écritures'],acc_statement:['statement','Interrogation et lettrage'],acc_bank:['bank','Rapprochement bancaire'],
 acc_vat:['vat','Situation de TVA'],acc_cloture:['cloture','Clôtures mensuelles'],acc_fiscal:['fiscal','Exercices et RAN'],acc_financial:['financial','États financiers']
} as const;
type WorkRoute=keyof typeof sections;
const mobileGroups=[
 ['Écritures',['acc_journals','acc_entry','acc_search','acc_statement']],
 ['Structure',['acc_plan','acc_journal_settings','acc_templates']],
 ['Banque et contrôles',['acc_bank','acc_revision','acc_cloture','acc_fiscal']],
 ['États',['acc_balance','acc_grandlivre','acc_tiers','acc_aging','acc_vat','acc_financial']],
 ['Autres traitements',['acc_analytics','acc_assets']],
 ['Aide',['acc_guide']],
] as const;
const isWork=(r:string):r is WorkRoute=>Object.prototype.hasOwnProperty.call(sections,r);
type Props={route:Route;onNavigate:(r:Route)=>void;canAccess:(r:Route)=>boolean};
export function AccountingDesktop(props:Props){
 const area=useRef<HTMLDivElement>(null);const {tenant}=useApp();
 const getArea=useCallback(()=>({x:0,y:0,w:Math.max(1,area.current?.clientWidth??900),h:Math.max(1,area.current?.clientHeight??600)}),[]);
 return <WindowManagerProvider key={tenant?.id??'no-tenant'} getArea={getArea}><Workspace {...props} area={area}/></WindowManagerProvider>;
}
function WindowScope({visible,actions,children}:{visible:boolean;actions:AccountingWorkActions;children:ReactNode}){
 const [last,setLast]=useState(actions.revision);
 useEffect(()=>{if(visible)setLast(actions.revision);},[visible,actions.revision]);
 return <AccountingWindowVisible.Provider value={visible}><AccountingWorkContext.Provider value={{...actions,revision:visible?actions.revision:last}}>{children}</AccountingWorkContext.Provider></AccountingWindowVisible.Provider>;
}
function AccountWork({tenantId,code,canManage,onView}:{tenantId:string;code:string;canManage:boolean;onView:ComponentProps<typeof AccountingAccountStatement>['onView']}){
 const work=useAccountingWork();return <AccountingAccountStatement tenantId={tenantId} initialAccount={code} canManage={canManage} refreshRevision={work?.revision??0} onView={onView}/>;
}
type Work =
 | {id:string;title:string;kind:'section';route:WorkRoute}
 | {id:string;title:string;kind:'piece';request:AccountingPieceRequest}
 | {id:string;title:string;kind:'account';code:string}
 | {id:string;title:string;kind:'import'}
 | {id:string;title:string;kind:'entry';journal:string;showTemplates?:number}
 | {id:string;title:string;kind:'template';source:EntryTemplateSource};
const isEntryWork=(work:Work)=>work.kind==='entry'||(work.kind==='section'&&work.route==='acc_entry');
function Workspace({route,onNavigate,canAccess,area}:Props&{area:RefObject<HTMLDivElement>}){
 const wm=useWindowManager();const {tenant}=useApp();const {can}=usePermissions();
 const [open,setOpen]=useState<Work[]>([]);
 const [active,setActive]=useState<string|null>(null);
 const [revision,setRevision]=useState(0);
 const nextRequest=useRef(0);
 const [compact,setCompact]=useState(()=>window.matchMedia('(max-width: 1023px)').matches);
 const [mobileHistory,setMobileHistory]=useState<string[]>([]);
 const mobilePage=mobileHistory[mobileHistory.length-1]??'acc_overview';
 const mobileOpen=(id:string)=>setMobileHistory(previous=>previous[previous.length-1]===id?previous:[...previous.filter(page=>page!==id),id]);
 const focusWork=(id:string)=>{if(compact)mobileOpen(id);else{wm.restore(id);setActive(id);}};
 useEffect(()=>{const mq=window.matchMedia('(max-width: 1023px)');const change=()=>setCompact(mq.matches);mq.addEventListener('change',change);return()=>mq.removeEventListener('change',change);},[]);
 const allowed=(w:Work)=>(w.kind!=='import'||can('manage_accounting'))&&canAccess(w.kind==='section'?w.route:w.kind==='account'?'acc_statement':w.kind==='import'?'acc_plan':w.kind==='entry'?'acc_entry':w.kind==='template'?'acc_templates':'acc_journals');
 const openRoute=useCallback((r:Route)=>{
  if(r==='acc_overview'){if(compact)mobileOpen(r);else{wm.minimizeAll();setActive(null);}return;}
  if(!isWork(r)||!canAccess(r))return;
  setOpen(p=>p.some(w=>w.id===r)?p:[...p,{id:r,kind:'section',route:r,title:sections[r][1]}]);
  focusWork(r);
 },[wm.restore,wm.minimizeAll,canAccess,compact]);
 useEffect(()=>{openRoute(route);},[route,compact]);
 useEffect(()=>{
  const handler=(e:Event)=>{const r=(e as CustomEvent<{route:Route}>).detail?.route;if(r)openRoute(r);};
  window.addEventListener('waarwi:accounting-open-window',handler);
  return()=>window.removeEventListener('waarwi:accounting-open-window',handler);
 },[openRoute]);
 useEffect(()=>{setOpen(p=>{const next=p.filter(allowed);return next.length===p.length?p:next;});},[canAccess]);
 const navigate=(r:string)=>{if(r==='acc_overview'||isWork(r)){openRoute(r);if(!compact)onNavigate(r as Route);}};
 const openPiece=(request:AccountingPieceRequest)=>{
  if(!canAccess('acc_journals')||!request.entryNumber)return;
  const id='piece:'+request.entryNumber;
  if(request.selectTemplateLines)request={...request,templateSelectionRequest:++nextRequest.current};
  setOpen(p=>{
   const old=p.find(w=>w.id===id);
   if(old?.kind==='piece'){
    if(!request.reverse&&!request.selectTemplateLines)return p;
    return p.map(w=>w.id===id?{...old,request:{...old.request,...request}}:w);
   }
   return [...p,{id,kind:'piece',title:'Pièce '+request.entryNumber,request}];
  });
  focusWork(id);
 };
 const openAccount=(code:string)=>{
  if(!canAccess('acc_statement')||!code)return;const id='account:'+code;
  setOpen(p=>p.some(w=>w.id===id)?p:[...p,{id,kind:'account',title:'Compte '+code,code}]);focusWork(id);
 };
 const openPlanImport=()=>{if(!canAccess('acc_plan')||!can('manage_accounting'))return;const id='plan:import';setOpen(p=>p.some(w=>w.id===id)?p:[...p,{id,kind:'import',title:'Import du plan comptable'}]);focusWork(id);};
 const openEntry=(journal:string,showTemplates=false)=>{
  if(!canAccess('acc_entry'))return;
  const id='entry:'+journal;
  const showTemplatesRequest=showTemplates?++nextRequest.current:undefined;
  setOpen(previous=>previous.some(work=>work.id===id)
   ? previous.map(work=>work.id===id&&work.kind==='entry'&&showTemplatesRequest?{...work,showTemplates:showTemplatesRequest}:work)
   : [...previous,{id,kind:'entry',title:journal?'Saisie des écritures │ '+journal:'Saisie des écritures',journal,showTemplates:showTemplatesRequest}]);
  focusWork(id);
 };
 const openTemplate=(source:EntryTemplateSource)=>{
  if(!canAccess('acc_templates')||!can('manage_accounting'))return;
  const id='template:'+ ++nextRequest.current;
  setOpen(previous=>[...previous,{id,kind:'template',title:'Nouveau modèle de saisie',source}]);
  if(compact)mobileOpen(id);else setActive(id);
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
 const selected=active&&open.some(w=>w.id===active)&&!wm.windows.find(w=>w.id===active)?.minimized?active:(visible.slice().sort((a,b)=>b.zIndex-a.zIndex)[0]?.id??null);
 const tilePossible=!compact&&visible.length>=2&&visible.length<=4&&wm.getArea().w>=680&&wm.getArea().h>=(visible.length>2?380:190);
 const tile=()=>{if(tilePossible)wm.tileVisibleWindows();};
 const cascade=()=>{const a=wm.getArea();visible.slice().sort((x,y)=>x.zIndex-y.zIndex).forEach((w,i)=>{const offset=16+(i%6)*22;wm.setMaximized(w.id,false);wm.updateRect(w.id,{x:Math.min(offset,Math.max(0,a.w-320)),y:Math.min(offset,Math.max(0,a.h-170)),w:Math.min(1100,Math.max(1,a.w-offset-18)),h:Math.min(730,Math.max(1,a.h-offset-18))});});};
 const closeAll=()=>{if(!window.dispatchEvent(new CustomEvent('waarwi:accounting-before-navigate',{cancelable:true,detail:{}})))return;setOpen([]);setActive(null);onNavigate('acc_overview');};
 useEffect(()=>{const h=(e:Event)=>{switch((e as CustomEvent<{action:string}>).detail?.action){case 'home':navigate('acc_overview');break;case 'tile':tile();break;case 'cascade':cascade();break;case 'closeAll':closeAll();break;}};window.addEventListener('waarwi:accounting-window-action',h);return()=>window.removeEventListener('waarwi:accounting-window-action',h);});
 const actions={openPiece,openAccount,openPlanImport,openEntry,openTemplate,refresh:()=>setRevision(v=>v+1),revision};
 const renderWork=(w:Work,onExit:()=>void)=>{
  if(w.kind==='section')return <Accounting section={sections[w.route][0]} inWindow onNavigate={navigate} onExit={onExit}/>;
  if(w.kind==='entry')return <Accounting section="entry" inWindow initialJournal={w.journal} openTemplatesRequest={w.showTemplates} onNavigate={navigate} onExit={onExit}/>;
  if(w.kind==='template')return <Accounting section="templates" inWindow templateSource={w.source}/>;
  if(w.kind==='piece')return <AccountingPiece request={w.request} onPosted={actions.refresh}/>;
  if(w.kind==='import')return <div className="accounting-workspace"><AccountingPlanIO accounts={[]} importOnly onClose={onExit} onImportDone={actions.refresh}/></div>;
  return tenant&&<div className="accounting-workspace"><AccountWork tenantId={tenant.id} code={w.code} canManage={can('manage_accounting')} onView={r=>openPiece({entryId:r.entry_id,entryNumber:r.entry_number})}/></div>;
 };
 if(compact){
  const works=open.filter(w=>mobileHistory.includes(w.id)&&allowed(w));
  const current=works.find(w=>w.id===mobilePage);
  const page=current?mobilePage:mobilePage==='more'?'more':'acc_overview';
  const showDock=!current||(!isEntryWork(current)&&current.kind!=='piece'&&current.kind!=='import'&&current.kind!=='template');
  const canLeave=()=>window.dispatchEvent(new CustomEvent('waarwi:accounting-before-navigate',{cancelable:true,detail:{windowId:page}}));
  const back=()=>{
   if(!canLeave())return;
   setMobileHistory(previous=>previous.slice(0,-1));
   if(current&&current.kind!=='section')setOpen(previous=>previous.filter(w=>w.id!==current.id));
  };
  const menu=()=>{
   if(!canLeave())return;
   mobileOpen('more');
  };
  const links=[['acc_overview','Accueil',LayoutGrid],['acc_journals','Journaux',BookOpen],['acc_search','Recherche',Search],['more','Plus',MoreHorizontal]] as const;
  return <AccountingMobile.Provider value><AccountingWorkContext.Provider value={actions}><section className="acc-mobile" aria-label="Comptabilité mobile">
   <header className="acc-mobile-header">
    {page!=='acc_overview'&&<button type="button" aria-label="Retour" onClick={back}><ArrowLeft size={20}/></button>}
    <h1>{current?.title??(page==='more'?'Modules comptables':'Comptabilité')}</h1>
   </header>
   <div className="acc-mobile-page" hidden={page!=='acc_overview'}><Accounting section="overview" inWindow onNavigate={navigate}/></div>
   {page==='more'&&<div className="acc-mobile-page acc-mobile-menu">
    {mobileGroups.map(([name,routes])=>routes.some(canAccess)&&<section key={name}><h2>{name}</h2>{routes.filter(canAccess).map(r=><button type="button" key={r} onClick={()=>navigate(r)}>{sections[r][1]}</button>)}</section>)}
   </div>}
   {works.map(w=><div key={w.id} hidden={page!==w.id} className={isEntryWork(w)?'acc-mobile-page acc-mobile-entry-view':'acc-mobile-page'}>
    <WindowId.Provider value={w.id}><WindowScope actions={actions} visible={page===w.id}>{renderWork(w,back)}</WindowScope></WindowId.Provider>
   </div>)}
   {showDock&&<nav className="acc-mobile-dock" aria-label="Navigation comptable">
    {links.filter(([id])=>id==='more'||canAccess(id)).map(([id,label,Icon])=><button type="button" key={id} aria-current={page===id?'page':undefined} onClick={()=>{
     if(id==='more'){menu();return;}
     if(page===id||!canLeave())return;
     navigate(id);
    }}><Icon size={19}/><span>{label}</span></button>)}
   </nav>}
  </section></AccountingWorkContext.Provider></AccountingMobile.Provider>;
 }
 return <AccountingWorkContext.Provider value={actions}><section className="acc-desktop" aria-label="Bureau comptable">
  <div className="acc-desktop-area" ref={area}>
   <div className="acc-desktop-home"><Accounting section="overview" onNavigate={navigate}/></div>
   {open.filter(allowed).map((w,index)=>{
    const a=wm.getArea();const offset=18+(index%5)*22;const id=w.id;
    return <DesktopWindow key={id} id={id} title={w.title} contained active={selected===id} onActivate={()=>{setActive(id);if(w.kind==='section'&&route!==w.route)onNavigate(w.route);}} minW={320} minH={170} startMaximized={w.kind==='section'||w.kind==='entry'} initialRect={{x:Math.min(offset,Math.max(0,a.w-400)),y:Math.min(offset,Math.max(0,a.h-270)),w:Math.min(w.kind==='piece'?850:1150,Math.max(1,a.w-offset-22)),h:Math.max(1,a.h-offset-22)}} onClose={()=>close(w)} onMinimize={()=>minimize(w)}>
      <WindowId.Provider value={id}>
        <WindowScope actions={actions} visible={!wm.windows.find(x=>x.id===id)?.minimized&&(!compact||selected===id)}>
          <div className="acc-window-content">
            {renderWork(w,()=>close(w))}
          </div>
        </WindowScope>
      </WindowId.Provider>
    </DesktopWindow>;
   })}
  </div>
  <div className="acc-desktop-taskbar" aria-label="Fenêtres ouvertes">
   <button type="button" className="acc-task-action" title="Afficher le bureau comptable" aria-label="Afficher le bureau comptable" onClick={()=>navigate('acc_overview')}><BookOpen size={16}/><span>Bureau</span></button>
   <div className="acc-desktop-tasks">{open.filter(allowed).map(o=>{const w=wm.windows.find(w=>w.id===o.id);return <div className="acc-task" key={o.id} data-active={selected===o.id&&!w?.minimized}><button type="button" title={o.title} aria-label={'Afficher '+o.title} aria-pressed={selected===o.id&&!w?.minimized} onClick={()=>activate(o)}>{w?.minimized?<Minus size={14} aria-hidden="true"/>:<BookOpen size={14} aria-hidden="true"/>}<span>{o.title}</span></button><button type="button" aria-label={'Fermer '+o.title} onClick={()=>close(o)}><X size={13}/></button></div>;})}</div>
   {open.length>0&&<><button type="button" className="acc-task-action acc-tile-control" disabled={!tilePossible} title="Répartir les fenêtres" aria-label="Répartir les fenêtres" onClick={tile}><LayoutGrid size={16}/></button><button type="button" className="acc-task-action" title="Fermer toutes les fenêtres" aria-label="Fermer toutes les fenêtres" onClick={closeAll}><X size={16}/></button></>}
  </div>
 </section></AccountingWorkContext.Provider>;
}
