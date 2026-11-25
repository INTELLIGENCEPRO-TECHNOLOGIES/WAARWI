// États de travail SYSCOHADA : correspondances prudentes et explicites.
// Les comptes non classés restent visibles ; ne pas certifier une liasse sur ce seul calcul.
export const balanceLabels={immobilisations:'Actif immobilisé net',stocks:'Stocks nets',clients:'Créances clients',otherReceivables:'Autres créances',cash:'Trésorerie-actif',equity:'Capitaux propres',result:'Résultat net de l’exercice',financialDebt:'Dettes financières et provisions',suppliers:'Dettes fournisseurs',otherDebt:'Autres dettes',cashDebt:'Trésorerie-passif'};
export const incomeLabels={TA:'Ventes de marchandises',RA:'Achats de marchandises',RB:'Variation des stocks de marchandises',XA:'Marge commerciale',TB:'Ventes de produits fabriqués',TC:'Travaux et services vendus',TD:'Produits accessoires',XB:'Chiffre d’affaires',TE:'Production stockée',TF:'Production immobilisée',TG:'Subventions d’exploitation',TH:'Autres produits',TI:'Transferts de charges d’exploitation',RC:'Autres achats',RD:'Variation des autres stocks',RE:'Transports',RF:'Services extérieurs',RG:'Impôts et taxes',RH:'Autres charges',XC:'Valeur ajoutée',RK:'Charges de personnel',XD:'Excédent brut d’exploitation',TJ:'Reprises d’exploitation',RL:'Dotations d’exploitation',XE:'Résultat d’exploitation',TK:'Produits financiers',RM:'Charges financières',XF:'Résultat financier',XG:'Résultat des activités ordinaires',TN:'Produits HAO',RO:'Charges HAO',XH:'Résultat hors activités ordinaires',RQ:'Participation des travailleurs',RS:'Impôts sur le résultat',XI:'Résultat net'};
const assets=['immobilisations','stocks','clients','otherReceivables','cash'];
const liabilities=['equity','result','financialDebt','suppliers','otherDebt','cashDebt'];
function cents(x){if(x===null||x===undefined||x==='')throw Error('Montant comptable manquant.');const n=Number(x);const c=Math.round(n*100);if(!Number.isFinite(n)||!Number.isSafeInteger(c)||Math.abs(n-c/100)>0.0000001)throw Error('Montant comptable hors précision.');return c;}
function add(a,b){const n=a+b;if(!Number.isSafeInteger(n))throw Error('Total comptable hors précision.');return n;}
function sum(...xs){return xs.reduce(add,0);}
function incomeKey(code,cls){
 if(cls===6){if(code.startsWith('601'))return 'RA';if(code.startsWith('6031'))return 'RB';if(code.startsWith('603'))return 'RD';if(code.startsWith('60'))return 'RC';if(code.startsWith('61'))return 'RE';if(/^(62|63)/.test(code))return 'RF';if(code.startsWith('64'))return 'RG';if(code.startsWith('659'))return 'RL';if(code.startsWith('65'))return 'RH';if(code.startsWith('66'))return 'RK';if(/^(67|697)/.test(code))return 'RM';if(/^(68|691)/.test(code))return 'RL';}
 if(cls===7){if(code.startsWith('701'))return 'TA';if(/^70[234]/.test(code))return 'TB';if(/^70[56]/.test(code))return 'TC';if(code.startsWith('707'))return 'TD';if(code.startsWith('73'))return 'TE';if(code.startsWith('72'))return 'TF';if(code.startsWith('71'))return 'TG';if(code.startsWith('759')||code.startsWith('791'))return 'TJ';if(code.startsWith('75'))return 'TH';if(code.startsWith('781'))return 'TI';if(/^(77|787|797)/.test(code))return 'TK';}
 if(cls===8){if(/^(82|84|86|88)/.test(code))return 'TN';if(/^(81|83|85)/.test(code))return 'RO';if(code.startsWith('87'))return 'RQ';if(code.startsWith('89'))return 'RS';}
 return null;
}
function balanceKey(code,cls,b){
 if(cls===1){if(/^1[0-4]/.test(code))return 'equity';if(/^1[5-9]/.test(code))return 'financialDebt';}
 if(cls===2)return 'immobilisations';
 if(cls===3)return 'stocks';
 if(cls===4){
  if(code.startsWith('491'))return 'clients';
  if(code.startsWith('49'))return 'otherReceivables';
  if(code.startsWith('41'))return b>=0?'clients':'otherDebt';
  if(code.startsWith('40'))return b<=0?'suppliers':'otherReceivables';
  if(/^4[2345678]/.test(code))return b>=0?'otherReceivables':'otherDebt';
 }
 if(cls===5){if(/^5[1234578]/.test(code))return b>=0?'cash':'cashDebt';if(code.startsWith('56'))return 'cashDebt';if(code.startsWith('59'))return 'cash';}
 return null;
}
/** @param {{rows:{account_code:string,account_name:string,account_class:number,opening:number,debit:number,credit:number,balance:number}[],result:number,prior_missing:boolean}} snapshot */
export function buildFinancialStatements(snapshot){
 const balance=Object.fromEntries(Object.keys(balanceLabels).map(k=>[k,0]));
 const income=Object.fromEntries(Object.keys(incomeLabels).map(k=>[k,0]));
 const unknown=[];const accounts=[];let result=0;let openingCash=0;let endingCash=0;let ledgerNet=0;let movementNet=0;let openingNet=0;
 for(const r of snapshot.rows){
  const code=String(r.account_code),cls=Number(r.account_class),d=cents(r.debit),c=cents(r.credit),o=cents(r.opening),b=cents(r.balance);
  if(b!==sum(o,d,-c))throw Error('Solde incohérent pour le compte '+code);
  ledgerNet=add(ledgerNet,b);movementNet=sum(movementNet,d,-c);openingNet=add(openingNet,o);
  let key=null,amount=0;
  if(cls>=6&&cls<=8){amount=sum(c,-d);result=add(result,amount);key=incomeKey(code,cls);if(key)income[key]=add(income[key],amount);}
  else if(cls>=1&&cls<=5){key=balanceKey(code,cls,b);amount=key&&liabilities.includes(key)?-b:b;if(key)balance[key]=add(balance[key],amount);}
  if(!key&&(b!==0||d!==0||c!==0||o!==0))unknown.push({code,name:r.account_name,amount:b/100});
  if(cls===5&&/^5[1234567]/.test(code)){openingCash=add(openingCash,o);endingCash=add(endingCash,b);}
  accounts.push({code,name:r.account_name,section:key,opening:o/100,debit:d/100,credit:c/100,balance:b/100});
 }
 balance.result=result;
 income.XA=sum(income.TA,income.RA,income.RB);
 income.XB=sum(income.TA,income.TB,income.TC,income.TD);
 income.XC=sum(income.XB,income.RA,income.RB,...['TE','TF','TG','TH','TI','RC','RD','RE','RF','RG','RH'].map(k=>income[k]));
 income.XD=sum(income.XC,income.RK);income.XE=sum(income.XD,income.TJ,income.RL);income.XF=sum(income.TK,income.RM);
 income.XG=sum(income.XE,income.XF);income.XH=sum(income.TN,income.RO);income.XI=sum(income.XG,income.XH,income.RQ,income.RS);
 const active=sum(...assets.map(k=>balance[k])),passive=sum(...liabilities.map(k=>balance[k]));
 const issues=[];
 if(snapshot.prior_missing)issues.push('Solde d’ouverture non certifié : clôturez l’exercice précédent.');
 if(unknown.length)issues.push('Des comptes restent à classer.');
 if(ledgerNet||movementNet||openingNet)issues.push('Balance source déséquilibrée.');
 if(income.XI!==result||result!==cents(snapshot.result))issues.push('Résultat détaillé différent du résultat comptable.');
 if(active!==passive)issues.push('Actif et passif différents.');
 // ZH/ZA indicatifs : sans classification des contreparties, aucun flux par activité n'est inventé.
 const money=o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,v/100]));
 return {balance:money(balance),income:money(income),totalAssets:active/100,totalLiabilities:passive/100,result:result/100,unknown,issues,accounts,
 cash:{opening:openingCash/100,closing:endingCash/100,variation:sum(endingCash,-openingCash)/100}};
}
