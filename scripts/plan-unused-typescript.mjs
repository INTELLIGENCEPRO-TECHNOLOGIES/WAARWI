// Read-only TypeScript cleanup planner. Emits exact, reviewable edits; never writes files.
import ts from 'typescript';
import path from 'node:path';
const configPath=ts.findConfigFile(process.cwd(),ts.sys.fileExists,'tsconfig.app.json');
const config=ts.readConfigFile(configPath,ts.sys.readFile);
if(config.error)throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText,'\n'));
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,path.dirname(configPath));
const program=ts.createProgram(parsed.fileNames,parsed.options);
const diagnostics=ts.getPreEmitDiagnostics(program);
const byFile=new Map();
for(const d of diagnostics){
 if(!d.file||d.start==null||![6133,6196,6192].includes(d.code))continue;
 const name=path.relative(process.cwd(),d.file.fileName);
 if(!name.startsWith('src/'))continue;
 if(!byFile.has(name))byFile.set(name,{source:d.file,positions:new Set(),allImports:new Set()});
 const record=byFile.get(name);
 record.positions.add(d.start);
 if(d.code===6192)record.allImports.add(d.start);
}
const printer=ts.createPrinter({newLine:ts.NewLineKind.LineFeed,removeComments:false});
let total=0;
for(const [file,{source,positions,allImports}] of byFile){
 const edits=[];
 const at=n=>!!n&&positions.has(n.getStart(source));
 const add=(node,replacement,reason)=>{
  const start=node.getStart(source),end=node.getEnd(),old=source.text.slice(start,end);
  if(old!==replacement)edits.push({start,end,old,replacement,reason});
 };
 function visit(node){
  if(ts.isImportDeclaration(node)&&node.importClause){
   const clause=node.importClause,bindings=clause.namedBindings;
   const all=allImports.has(node.getStart(source))||allImports.has(clause.getStart(source));
   let name=at(clause.name)||all?undefined:clause.name;
   let newBindings=bindings;
   if(bindings&&ts.isNamedImports(bindings)){
    const keep=bindings.elements.filter(e=>!all&&!at(e.name)&&!at(e));
    if(keep.length!==bindings.elements.length)newBindings=keep.length?ts.factory.updateNamedImports(bindings,keep):undefined;
   }else if(bindings&&ts.isNamespaceImport(bindings)&&(all||at(bindings.name)||at(bindings)))newBindings=undefined;
   if(name!==clause.name||newBindings!==bindings){
    if(!name&&!newBindings)add(node,'','import inutilisé');
    else {
     const next=ts.factory.updateImportClause(clause,clause.isTypeOnly,name,newBindings);
     add(node,printer.printNode(ts.EmitHint.Unspecified,ts.factory.updateImportDeclaration(node,node.modifiers,next,node.moduleSpecifier,node.attributes),source),'imports inutilisés');
    }
   }
   return;
  }
  if((ts.isFunctionDeclaration(node)||ts.isTypeAliasDeclaration(node)||ts.isInterfaceDeclaration(node))&&at(node.name)&&!node.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword||m.kind===ts.SyntaxKind.DefaultKeyword)){
   add(node,'','déclaration locale non référencée');return;
  }
  if(ts.isVariableStatement(node)&&node.declarationList.declarations.length===1){
   const d=node.declarationList.declarations[0];
   if(ts.isIdentifier(d.name)&&at(d.name)&&d.initializer&&(ts.isArrowFunction(d.initializer)||ts.isFunctionExpression(d.initializer))){
    add(node,'','fonction locale non référencée');return;
   }
  }
  if(ts.isObjectBindingPattern(node)){
   if(!node.elements.some(e=>e.dotDotDotToken||e.initializer)&&!source.text.slice(node.getStart(source),node.end).includes('/*')&&!source.text.slice(node.getStart(source),node.end).includes('//')){
    const keep=node.elements.filter(e=>!(ts.isIdentifier(e.name)&&at(e.name)));
    if(keep.length&&keep.length!==node.elements.length){add(node,'{ '+keep.map(e=>e.getText(source)).join(', ')+' }','propriétés non utilisées');return;}
   }
  }
  if(ts.isArrayBindingPattern(node)){
   const elements=[...node.elements];
   const remove=elements.map(e=>ts.isBindingElement(e)&&ts.isIdentifier(e.name)&&!e.initializer&&!e.dotDotDotToken&&at(e.name));
   if(remove.some(Boolean)&&elements.some((e,i)=>!remove[i]&&!ts.isOmittedExpression(e))){
    const parts=elements.map((e,i)=>remove[i]?'':e.getText(source));
    while(parts.length>1&&parts[parts.length-1]==='')parts.pop();
    add(node,'['+parts.join(', ')+']','valeur de tuple non utilisée, appel conservé');return;
   }
  }
  if(ts.isParameter(node)&&ts.isIdentifier(node.name)&&at(node.name)&&!node.name.text.startsWith('_')){
   // The parameter remains in its contractual position. No runtime or signature change.
   const candidate='_'+node.name.text;
   if(!source.text.includes(candidate))add(node.name,candidate,'paramètre imposé par la signature, non utilisé');
   return;
  }
  ts.forEachChild(node,visit);
 }
 visit(source);
 const chosen=edits.sort((a,b)=>a.start-b.start||b.end-a.end).filter((e,i,a)=>!a.slice(0,i).some(p=>p.start<=e.start&&p.end>=e.end));
 if(chosen.length){
  total+=chosen.length;
  console.log('WAARWI_CLEANUP_PLAN '+JSON.stringify({file,edits:chosen}));
 }
}
console.log('WAARWI_CLEANUP_TOTAL '+JSON.stringify({files:byFile.size,diagnostics:diagnostics.length,edits:total}));
