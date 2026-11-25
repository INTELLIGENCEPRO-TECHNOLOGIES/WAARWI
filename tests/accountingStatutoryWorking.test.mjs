import test from 'node:test';
import assert from 'node:assert/strict';
import {detailedAssets,suggestIndirect,indirectFlow,flowInputKeys} from '../src/lib/accountingStatutoryWorking.mjs';
const row=(code,cls,opening,debit,credit)=>({account_code:code,account_name:code,account_class:cls,opening,debit,credit,balance:opening+debit-credit});
test('actif brut, corrections de valeur et net',()=>{
 const s={rows:[row('2410000',2,1000,0,0),row('2841000',2,-300,0,0),row('3110000',3,500,0,0),row('3910000',3,-50,0,0),row('4110000',4,200,0,0),row('4910000',4,-20,0,0)],result:0,prior_missing:false};
 const r=detailedAssets(s,1330);assert.equal(r.total.gross,1700);assert.equal(r.total.impairment,370);assert.equal(r.total.net,1330);assert.deepEqual(r.issues,[]);
});
test('actif atypique visible',()=>{const r=detailedAssets({rows:[row('2010000',2,100,0,0)]},100);assert.ok(r.issues.length>0);});
test('proposition simple avec variation du besoin en fonds de roulement',()=>{
 const s={rows:[row('5210000',5,0,100,0),row('4110000',4,0,200,0),row('7010000',7,0,0,300)],result:300,prior_missing:false};
 const p=suggestIndirect(s);const f=indirectFlow(0,100,p.proposed);assert.equal(p.proposed.FA,300);assert.equal(p.proposed.FD,-200);assert.equal(f.values.ZB,100);assert.equal(f.gap,0);assert.equal(f.complete,true);
});
test('opérations complexes ne sont pas inventées',()=>{
 const s={rows:[row('6810000',6,0,100,0),row('2841000',2,0,0,100),row('4040000',4,0,0,400)],result:-100,prior_missing:false};const p=suggestIndirect(s);
 assert.equal(p.proposed.FA,undefined);assert.equal(p.proposed.FD,undefined);assert.equal(p.proposed.FG,undefined);
 const f=indirectFlow(0,0,p.proposed);assert.equal(f.complete,false);assert.equal(f.values.ZH,null);
});
test('tableau complet équilibré avec investissement et financement',()=>{
 const input=Object.fromEntries(flowInputKeys.map(k=>[k,0]));Object.assign(input,{FA:800,FC:-100,FG:-200,FO:500,FQ:-100});
 const f=indirectFlow(1000,1900,input);assert.equal(f.values.ZB,700);assert.equal(f.values.ZC,-200);assert.equal(f.values.ZF,400);assert.equal(f.values.ZH,1900);assert.equal(f.complete,true);
 const bad=indirectFlow(1000,1899,input);assert.equal(bad.gap,1);assert.equal(bad.complete,false);
});
test('refus du signe erroné et du montant non précis',()=>{assert.throws(()=>indirectFlow(0,0,{FG:1}));assert.throws(()=>indirectFlow(0,0,{FO:-1}));assert.throws(()=>indirectFlow(0,0,{FA:0.001}));});
