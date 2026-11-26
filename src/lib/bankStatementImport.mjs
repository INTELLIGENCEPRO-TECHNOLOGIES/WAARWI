// Shared pure parsing: no inferred sign, no rounding or ambiguous date coercion.
export const normalizeBankHeader=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/[ _-]+/g,' ');
export function bankMinor(v){
 const s=String(v??'').trim().replace(/[\s\u00a0\u202f]/g,'').replace(',','.');
 if(!/^-?\d+(\.\d{1,2})?$/.test(s))throw Error('Montant invalide (deux décimales maximum).');
 const negative=s.startsWith('-');const [whole,fraction='']=s.replace(/^-/,'').split('.');
 const cents=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
 // Below 2^46 currency units every cent remains distinguishable in a JS number.
 // Refuse beyond this boundary instead of silently rounding input or RPC payloads.
 if(cents>=7036874417766400n)throw Error('Montant hors limite de précision.');
 return Number(negative?-cents:cents);
}
export function bankDate(v){
 let date;if(v instanceof Date&&Number.isFinite(v.getTime()))date=v.toISOString().slice(0,10);
 else {const s=String(v??'').trim();const d=s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);date=d?d[3]+'-'+d[2]+'-'+d[1]:s;}
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<'2000-01-01'||date>'2099-12-31')throw Error('Date attendue : AAAA-MM-JJ ou JJ/MM/AAAA.');
 const dt=new Date(date+'T00:00:00Z');if(!Number.isFinite(dt.getTime())||dt.toISOString().slice(0,10)!==date)throw Error('Date inexistante.');return date;
}
export function parseDelimited(text,delimiter){
 const rows=[];let row=[],field='',quoted=false,closed=false;const s=text.replace(/^\uFEFF/,'');
 const push=()=>{row.push(field);field='';closed=false;};
 const end=()=>{push();rows.push(row);row=[];};
 for(let i=0;i<s.length;i++){const c=s[i];if(quoted){if(c==='"'){if(s[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
 if(c===delimiter){push();continue;}if(c==='\r'||c==='\n'){if(c==='\r'&&s[i+1]==='\n')i++;end();continue;}
 if(closed)throw Error('Caractère inattendu après un champ entre guillemets.');
 if(c==='"'){if(field.length)throw Error('Guillemet inattendu dans un champ.');quoted=true;}else field+=c;}
 if(quoted)throw Error('Champ entre guillemets non fermé.');if(field.length||row.length||closed)end();return rows;
}
export function bankRows(matrix,mode='signed'){
 const clean=matrix.filter(row=>row.some(v=>v!==null&&v!==undefined&&String(v).trim()!==''));
 if(clean.length<2)throw Error('Le fichier doit contenir une ligne d’en-tête et au moins une opération.');
 if(clean.length>501)throw Error('Maximum 500 opérations par relevé.');
 const h=clean[0].map(normalizeBankHeader);
 const col=(aliases,required=true)=>{const hits=h.map((x,i)=>aliases.includes(x)?i:-1).filter(i=>i>=0);if(hits.length>1||required&&!hits.length)throw Error('Colonne absente ou ambiguë : '+aliases[0]);return hits[0]??-1;};
 const date=col(['date','date operation','date d\'operation','date comptable']),ref=col(['reference','ref','numero de piece'],false),label=col(['libelle','description','operation','motif']);
 const amount=mode==='signed'?col(['montant','montant signe']):-1;
 const debit=mode==='signed'?-1:col(['debit']),credit=mode==='signed'?-1:col(['credit']);
 if(!['signed','bank','company'].includes(mode))throw Error('Convention de signe inconnue.');
 return clean.slice(1).map((r,i)=>{try{
  const val=k=>k<0?'':r[k]??'';
  const d=bankDate(val(date)),l=String(val(label)).trim(),reference=String(val(ref)).trim();if(!l||l.length>500||reference.length>120)throw Error('Libellé ou référence invalide.');
  let cents;if(mode==='signed')cents=bankMinor(val(amount));else{const a=String(val(debit)).trim()===''?0:bankMinor(val(debit)),b=String(val(credit)).trim()===''?0:bankMinor(val(credit));if(a<0||b<0||(a>0)===(b>0))throw Error('Un seul montant positif par opération.');cents=mode==='bank'?b-a:a-b;}
  if(!cents)throw Error('Montant nul interdit.');return {date:d,reference,label:l,amount:String(cents/100)};
 }catch(e){throw Error('Opération '+(i+1)+' : '+e.message);}});
}
export function bankCsv(text,mode='signed'){
 let result,success=0,last;for(const delimiter of [';',',','\t']){try{const matrix=parseDelimited(text,delimiter).filter(row=>row.some(v=>String(v).trim()!==''));if(matrix.some(row=>row.length!==matrix[0]?.length))throw Error('Nombre de colonnes incohérent.');const parsed=bankRows(matrix,mode);result=parsed;success++;}catch(e){last=e;}}
 if(success!==1)throw Error(success?'Séparateur ambigu.':last?.message||'CSV invalide.');return result;
}
