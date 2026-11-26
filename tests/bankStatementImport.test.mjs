import test from 'node:test';
import assert from 'node:assert/strict';
import {bankCsv,bankRows,bankDate,bankMinor} from '../src/lib/bankStatementImport.mjs';
test('CSV français, BOM, virgules décimales et guillemets',()=>{
 const r=bankCsv('\ufeffDate;Référence;Libellé;Montant\r\n26/11/2026;A;"Frais; dossier";-1 250,50');
 assert.deepEqual(r,[{date:'2026-11-26',reference:'A',label:'Frais; dossier',amount:'-1250.5'}]);
});
test('Conventions explicites banque et comptabilité',()=>{
 const m=[['Date','Libellé','Débit','Crédit'],['2026-11-26','Frais',1200,0]];
 assert.equal(bankRows(m,'bank')[0].amount,'-1200');assert.equal(bankRows(m,'company')[0].amount,'1200');
});
test('Refus des dates impossibles, décimales et doubles sens',()=>{
 assert.throws(()=>bankDate('31/02/2026'));assert.throws(()=>bankMinor('1,234'));
 assert.throws(()=>bankRows([['Date','Libellé','Débit','Crédit'],['2026-11-26','Frais',1200,200]],'bank'));
});
test('Échappement, séparateurs et date Excel formatée',()=>{
 assert.equal(bankCsv('Date;Libellé;Montant\n2026-11-26;"Frais ""test""";-100')[0].label,'Frais "test"');
 assert.equal(bankCsv('Date,Libellé,Montant\n2026-11-26,Virement,100')[0].amount,'100');
 assert.equal(bankRows([['Date','Libellé','Montant'],[new Date('2026-11-26T00:00:00Z'),'Virement',100]])[0].date,'2026-11-26');
});
test('Import intégral ou refus, jamais de troncage',()=>{
 assert.throws(()=>bankRows([['Date','Libellé','Montant'],...Array.from({length:501},()=>['2026-11-26','Virement',100])]));
 assert.throws(()=>bankCsv('Date;Libellé;Montant\n2026-11-26;OK;100\n2026-02-31;Erreur;10'));
 assert.throws(()=>bankCsv('Date;Libellé;Montant;Montant\n2026-11-26;OK;100;200'));
});

test('Conversion exacte des centimes et refus au-delà de la précision du transport numérique',()=>{
 assert.equal(bankMinor('0,29'),29);
 assert.equal(bankMinor('-0,01'),-1);
 assert.equal(bankMinor('70368744177663.99'),7036874417766399);
 assert.throws(()=>bankMinor('70368744177664.00'));
 assert.throws(()=>bankMinor('90071992547409.01'));
 assert.equal(bankRows([['Date','Libellé','Montant'],['2026-11-26','Virement','70368744177663.99']])[0].amount,'70368744177663.99');
});
