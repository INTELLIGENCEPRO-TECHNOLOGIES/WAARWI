// États détaillés de travail. Les corrections sont explicites, jamais déduites d'un écart.
export const assetLabels={intangible:'Immobilisations incorporelles',tangible:'Immobilisations corporelles',financial:'Immobilisations financières',inventory:'Stocks et encours',customers:'Clients',receivables:'Autres créances',cash:'Trésorerie-actif'};
export const flowLabels={ZA:'Trésorerie initiale',FA:'Capacité d’autofinancement globale',FB:'Variation actif circulant HAO',FC:'Variation stocks',FD:'Variation créances',FE:'Variation passif circulant',ZB:'Flux opérationnels',FF:'Acquisitions incorporelles',FG:'Acquisitions corporelles',FH:'Acquisitions financières',FI:'Cessions incorporelles et corporelles',FJ:'Cessions financières',ZC:'Flux investissement',FK:'Apports en capital',FL:'Subventions d’investissement encaissées',FM:'Prélèvements sur capital',FN:'Dividendes payés',ZD:'Flux capitaux propres',FO:'Emprunts reçus',FP:'Autres financements reçus',FQ:'Remboursements des financements',ZE:'Flux capitaux étrangers',ZF:'Flux financement',ZG:'Variation nette',ZH:'Trésorerie finale calculée'};
export const flowInputKeys=['FA','FB','FC','FD','FE','FF','FG','FH','FI','FJ','FK','FL','FM','FN','FO','FP','FQ'];
export const annexLabels={methods:'Principes et méthodes comptables',inventory:'Inventaire et évaluation des stocks',assets:'Immobilisations, amortissements et dépréciations',receivables:'Créances, échéances et risques',debts:'Dettes, échéances et garanties',equity:'Capitaux propres et affectation du résultat',commitments:'Engagements et passifs éventuels',tax:'Fiscalité et impôts',events:'Événements postérieurs et continuité',other:'Autres informations significatives'};
const signed=(v)=>{if(v===null||v===undefined||v==='')throw Error('Montant manquant.');const n=Number(v),c=Math.round(n*100);if(!Number.isFinite(n)||!Number.isSafeInteger(c)||Math.abs(n-c/100)>1e-7)throw Error('Montant invalide.');return c;};
const sum=(xs)=>xs.reduce((a,b)=>{const v=a+b;if(!Number.isSafeInteger(v))throw Error('Total hors précision.');return v;},0);
function assetKey(code,b){
 if(/^21/.test(code))return ['intangible',false];
 if(/^2[2345]/.test(code))return ['tangible',false];
 if(/^2[67]/.test(code))return ['financial',false];
 if(/^28[1]/.test(code)||/^29[1]/.test(code))return ['intangible',true];
 if(/^28[2345]/.test(code)||/^29[2345]/.test(code))return ['tangible',true];
 if(/^29[67]/.test(code))return ['financial',true];
 if(/^39/.test(code))return ['inventory',true];
 if(/^3[1-8]/.test(code))return ['inventory',false];
 if(/^491/.test(code))return ['customers',true];
 if(/^49[2345678]/.test(code))return ['receivables',true];
 if(/^59/.test(code))return ['cash',true];
 if(b>0&&/^41/.test(code))return ['customers',false];
 if(b>0&&/^4[02345678]/.test(code))return ['receivables',false];
 if(b>0&&/^5[1234578]/.test(code))return ['cash',false];
 return null;
}
export function detailedAssets(snapshot,expectedNet){
 const rows=Object.fromEntries(Object.keys(assetLabels).map(k=>[k,{gross:0,impairment:0,net:0}]));
 const issues=[];
 for(const r of snapshot.rows){
  const b=signed(r.balance),k=assetKey(String(r.account_code),b);
  if(!k){if(b!==0&&(Number(r.account_class)===2||Number(r.account_class)===3||/^49|^59/.test(r.account_code)))issues.push('Compte à ventiler : '+r.account_code);continue;}
  if(k[1]){rows[k[0]].impairment=sum([rows[k[0]].impairment,-b]);if(b>0)issues.push('Solde de correction débiteur : '+r.account_code);}
  else{rows[k[0]].gross=sum([rows[k[0]].gross,b]);if(b<0)issues.push('Actif à solde créditeur : '+r.account_code);}
 }
 for(const [k,r] of Object.entries(rows)){r.net=sum([r.gross,-r.impairment]);if(r.net<0)issues.push('Actif net négatif : '+assetLabels[k]);}
 const total={gross:sum(Object.values(rows).map(r=>r.gross)),impairment:sum(Object.values(rows).map(r=>r.impairment)),net:sum(Object.values(rows).map(r=>r.net))};
 if(total.net!==signed(expectedNet))issues.push('Écart avec le bilan agrégé : ventilation à vérifier.');
 const convert=r=>({gross:r.gross/100,impairment:r.impairment/100,net:r.net/100});
 return {rows:Object.fromEntries(Object.entries(rows).map(([k,r])=>[k,convert(r)])),total:convert(total),issues};
}
// Proposer uniquement les variations simples du cycle courant. Une situation
// complexe doit être documentée et retraitée par le comptable, rubrique par rubrique.
export function suggestIndirect(snapshot){
 const proposed={};const notes=[];
 const rows=snapshot.rows;const any=(re)=>rows.some(r=>re.test(String(r.account_code))&&(signed(r.opening)!==0||signed(r.debit)!==0||signed(r.credit)!==0));
 const variation=(re)=>sum(rows.filter(r=>re.test(String(r.account_code))).map(r=>signed(r.balance)-signed(r.opening)))/100;
 const managementComplex=any(/^(654|754|68|69|79|85|86|81|82|83|84|14|28|29|39|49|59)/);
 if(!managementComplex)proposed.FA=Number(snapshot.result);else notes.push('CAFG à retraiter : dotations, reprises, cessions ou opérations non monétaires.');
 if(!any(/^(39|478|479|475)/))proposed.FC=-variation(/^3[1-8]/);else notes.push('Stocks à retraiter hors dépréciations et écarts de conversion.');
 if(!any(/^(48|49|414|404|467|458|4494|475|472|478|479)/)){
  proposed.FB=0;
  let receivable=0,debt=0;
  for(const r of rows.filter(x=>/^4[01234567]/.test(x.account_code))){
   const o=signed(r.opening),b=signed(r.balance);
   receivable=sum([receivable,Math.max(b,0),-Math.max(o,0)]);
   debt=sum([debt,Math.max(-b,0),-Math.max(-o,0)]);
  }
  proposed.FD=-receivable/100;proposed.FE=debt/100;
 }else notes.push('Créances et dettes à retraiter : comptes HAO, immobilisations, capital ou conversion.');
 if(!any(/^2|^404|^414|^48[125]|^654|^754|^81|^82/))for(const k of ['FF','FG','FH','FI','FJ'])proposed[k]=0;
 if(!any(/^10|^14|^16|^17|^18|^465|^467|^458|^4494/))for(const k of ['FK','FL','FM','FN','FO','FP','FQ'])proposed[k]=0;
 if(snapshot.prior_missing)notes.push('Ouverture non certifiée : contrôler les montants proposés.');
 return {proposed,notes};
}
export function indirectFlow(opening,closing,inputs){
 const v={ZA:signed(opening)};const missing=[];
 for(const k of flowInputKeys){if(inputs[k]===undefined||inputs[k]===null||inputs[k]===''){v[k]=null;missing.push(k);}else v[k]=signed(inputs[k]);}
 for(const k of ['FF','FG','FH','FM','FN','FQ'])if(v[k]!==null&&v[k]>0)throw Error(k+' : un décaissement doit être négatif.');
 for(const k of ['FI','FJ','FK','FL','FO','FP'])if(v[k]!==null&&v[k]<0)throw Error(k+' : un encaissement doit être positif.');
 const total=(keys)=>keys.some(k=>v[k]===null)?null:sum(keys.map(k=>v[k]));
 v.ZB=total(['FA','FB','FC','FD','FE']);v.ZC=total(['FF','FG','FH','FI','FJ']);v.ZD=total(['FK','FL','FM','FN']);v.ZE=total(['FO','FP','FQ']);v.ZF=total(['ZD','ZE']);v.ZG=total(['ZB','ZC','ZF']);v.ZH=total(['ZA','ZG']);
 const gap=v.ZH===null?null:(v.ZH-signed(closing))/100;
 return {values:Object.fromEntries(Object.entries(v).map(([k,n])=>[k,n===null?null:n/100])),missing,gap,complete:missing.length===0&&gap===0};
}
