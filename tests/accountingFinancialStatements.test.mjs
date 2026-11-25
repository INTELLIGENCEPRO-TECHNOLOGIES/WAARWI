import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFinancialStatements as build} from '../src/lib/accountingFinancialStatements.mjs';
const row=(code,cls,opening,debit,credit)=>({account_code:code,account_name:code,account_class:cls,opening,debit,credit,balance:opening+debit-credit});
test('bénéfice, bilan équilibré et SIG',()=>{
 const x=build({prior_missing:false,result:800,rows:[row('5210000',5,0,1000,200),row('7010000',7,0,0,1000),row('6010000',6,0,200,0)]});
 assert.equal(x.totalAssets,800);assert.equal(x.totalLiabilities,800);assert.equal(x.income.XA,800);assert.equal(x.income.XB,1000);assert.equal(x.income.XI,800);assert.equal(x.cash.variation,800);assert.deepEqual(x.issues,[]);
});
test('perte et reprise des capitaux propres',()=>{
 const x=build({prior_missing:false,result:-200,rows:[row('5210000',5,1000,0,200),row('1010000',1,-1000,0,0),row('6580000',6,0,200,0)]});
 assert.equal(x.totalAssets,800);assert.equal(x.totalLiabilities,800);assert.equal(x.balance.result,-200);assert.equal(x.income.XI,-200);assert.deepEqual(x.issues,[]);
});
test('créances et dettes sans compensation entre comptes',()=>{
 const x=build({prior_missing:false,result:0,rows:[row('4110001',4,0,100,0),row('4110002',4,0,0,100)]});
 assert.equal(x.balance.clients,100);assert.equal(x.balance.otherDebt,100);assert.equal(x.totalAssets,x.totalLiabilities);
});
test('compte inconnu jamais ignoré',()=>{
 const x=build({prior_missing:false,result:100,rows:[row('5210000',5,0,100,0),row('7090000',7,0,0,100)]});
 assert.equal(x.unknown.length,1);assert.notEqual(x.income.XI,x.result);assert.ok(x.issues.length);
});
test('absence d’ouverture, solde incohérent et décimales',()=>{
 const x=build({prior_missing:true,result:0,rows:[]});assert.ok(x.issues.length);
 assert.throws(()=>build({prior_missing:false,result:0,rows:[{...row('5210000',5,0,1,0),balance:2}]}));
 assert.throws(()=>build({prior_missing:false,result:0,rows:[row('5210000',5,0,0.001,0)]}));
});
test('amortissements et dépréciations réduisent les actifs',()=>{
 const x=build({prior_missing:false,result:0,rows:[row('2410000',2,1000,0,0),row('2841000',2,-300,0,0),row('1010000',1,-700,0,0)]});
 assert.equal(x.balance.immobilisations,700);assert.equal(x.totalAssets,x.totalLiabilities);
});
