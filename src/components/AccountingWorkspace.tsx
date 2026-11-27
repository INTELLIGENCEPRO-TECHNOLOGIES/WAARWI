import {useState,useEffect,useRef,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {ChevronLeft,ChevronRight,MoreHorizontal,Eye,Copy,ArrowRightLeft,FileText} from './Icons';

export function useAccountingPagination<T>(rows:T[],resetKey:string){
 const [size,setSize]=useState(20);
 const [page,setPage]=useState(0);
 const pages=Math.max(1,Math.ceil(rows.length/size));
 const current=Math.min(page,pages-1);
 useEffect(()=>setPage(0),[resetKey,size]);
 return {rows:rows.slice(current*size,(current+1)*size),page:current,size,total:rows.length,setPage,setSize};
}
export function AccountingPagination({page,size,total,setPage,setSize,disabled=false}:{page:number;size:number;total:number;setPage:(n:number)=>void;setSize:(n:number)=>void;disabled?:boolean}){
 const pages=Math.max(1,Math.ceil(total/size));
 return <nav className="acc-pagination" aria-label="Pagination comptable">
  <span>{total?Math.min(page*size+1,total):0}–{Math.min((page+1)*size,total)} sur {total}</span>
  <label>Lignes <select aria-label="Lignes par page" value={size} disabled={disabled} onChange={e=>setSize(Number(e.target.value))}>{[5,10,20,50].map(n=><option key={n}>{n}</option>)}</select></label>
  <div className="acc-page-buttons"><button type="button" aria-label="Page précédente" className="acc-icon" disabled={disabled||page===0} onClick={()=>setPage(page-1)}><ChevronLeft size={17}/></button><span>{page+1} / {pages}</span><button type="button" aria-label="Page suivante" className="acc-icon" disabled={disabled||page+1>=pages} onClick={()=>setPage(page+1)}><ChevronRight size={17}/></button></div>
 </nav>;
}
export function AccountingTable({ children, footer, label = 'Tableau comptable', fill = false }: { children: ReactNode; footer?: ReactNode; label?: string; fill?: boolean }) {
 return <div className={fill ? "acc-table-frame acc-table-fill" : "acc-table-frame"} data-fill={fill || undefined}>
  <div className="acc-table-scroll" role="region" tabIndex={0} aria-label={label}>{children}</div>
  {footer}
 </div>;
}
export function AccountingRowActions({piece,onView,onReverse,reverseDisabledReason,onTemplate,anchor,onDismiss}:{piece:string;onView:()=>void;onReverse?:()=>void;reverseDisabledReason?:string;onTemplate?:()=>void;anchor?:{x:number;y:number};onDismiss?:()=>void}){
 const [local,setLocal]=useState(false);
 const [copied,setCopied]=useState(false);
 const ref=useRef<HTMLDivElement>(null);
 const buttonRef=useRef<HTMLButtonElement>(null);
 const active=!!anchor||local;
 const dismiss=()=>{setLocal(false);onDismiss?.();};
 useEffect(()=>{
  if(!active)return;
  const down=(e:MouseEvent)=>{if(!ref.current?.contains(e.target as Node)&&!buttonRef.current?.contains(e.target as Node))dismiss();};
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){dismiss();buttonRef.current?.focus();}};
  const scroll=()=>dismiss();
  document.addEventListener('mousedown',down);document.addEventListener('keydown',key);window.addEventListener('scroll',scroll,true);window.addEventListener('resize',scroll);
  return()=>{document.removeEventListener('mousedown',down);document.removeEventListener('keydown',key);window.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',scroll);};
 },[active,anchor,onDismiss]);
 const copy=async()=>{try{await navigator.clipboard.writeText(piece);setCopied(true);}catch{setCopied(false);}};
 const bounds=buttonRef.current?.getBoundingClientRect();
 const x=anchor?.x??bounds?.right??0,y=anchor?.y??bounds?.bottom??0;
 return <><button ref={buttonRef} type="button" className="acc-icon" aria-label={'Actions '+piece} aria-expanded={active} onClick={()=>{if(active)dismiss();else{setCopied(false);setLocal(true);}}}><MoreHorizontal size={18}/></button>{active&&createPortal(<div className="accounting-workspace acc-context-root"><div ref={ref} className="acc-context" style={{left:Math.max(8,Math.min(x-210,window.innerWidth-224)),top:Math.max(8,Math.min(y,window.innerHeight-190)),zIndex:10000}} onClick={e=>e.stopPropagation()}>
 <span className="acc-context-label">{piece}</span><button type="button" onClick={()=>{dismiss();onView();}}><Eye size={16}/>Consulter la pièce</button><button type="button" onClick={()=>void copy()}><Copy size={16}/>{copied?'Numéro copié':'Copier le numéro'}</button>{onTemplate&&<button type="button" onClick={()=>{dismiss();onTemplate();}}><FileText size={16}/>Créer un modèle de saisie</button>}{(onReverse||reverseDisabledReason)&&<><div style={{borderTop:'1px solid var(--w-separator)',margin:'3px 0'}}/><button type="button" disabled={!onReverse} title={reverseDisabledReason} onClick={()=>{dismiss();onReverse?.();}}><ArrowRightLeft size={16}/><span>Extourner l’écriture{reverseDisabledReason&&<small style={{display:'block',fontSize:10}}>{reverseDisabledReason}</small>}</span></button></>}</div></div>,document.body)}</>;
}
