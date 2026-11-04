import re,sys
def rm(path, names):
    s=open(path).read()
    def fix(m):
        body=m.group(2)
        parts=[x.strip() for x in body.split(',') if x.strip()]
        keep=[x for x in parts if re.sub(r'^type\s+','',x).split(' as ')[-1].strip() not in names]
        if not keep: return ''
        sep=',\n  ' if '\n' in body else ', '
        if '\n' in body: return m.group(1)+'{\n  '+sep.join(keep)+',\n}'+m.group(3)
        return m.group(1)+'{ '+', '.join(keep)+' }'+m.group(3)
    s=re.sub(r"(import (?:type )?)\{([^}]*)\}( from '[^']+';\n?)",fix,s)
    open(path,'w').write(s)
rm('src/pages/POS.tsx',{'CashModal','CashMovementKind','HandCoins','ArrowUpRight','formatDateTime','formatNumber','printDecaissementTicket80','printDocumentA4','printEncaissementTicket80','printReturnTicket80Shared','printTicket80Shared','printXReport80','printXReport','buildCloseControlLines','ControlLine','fetchPrepayAvailable','ArrowDownToLine','Banknote','Plus','Minus','ArrowLeft','Fragment','Flame','Zap','Monitor','Network','BookOpen','validerDocumentsIpm','IpmDocuments'})
rm('src/components/cash/SaleReturnModal.tsx',{'formatDateTime'})
rm('src/components/cash/SessionStatsModal.tsx',{'formatDateTime','SessionSale'})
rm('src/components/cash/SessionTicketsModal.tsx',{'CashMovementKind','CashSession','formatNumber'})
