import re
p='src/pages/POS.tsx'
s=open(p).read()
# shared sale doc print
a=s.index("  const printSaleTicket = (sale:"); b=s.index("  const autoMode = isAutoParts(tenant);",a)
old=s[a:b]
saleT="{ sale_number: string; created_at: string; total: number; discount: number; items: CartItem[]; payments: SalePayment[]; customer: Customer | null }"
body_t=old[old.index("    printTicket80Shared({"):old.index("  const printSaleInvoice")].rstrip()
body_t=body_t[:body_t.rindex("  };")].rstrip()
body_t=body_t.replace("docHeader: docHeaderOverride !== undefined ? docHeaderOverride : buildDocHeader(),","docHeader,").replace("}, tenantForPrint, cashierName);","}, tenant, cashier);")
bi=old.index("  const printSaleInvoice"); body_i=old[old.index("\n",bi)+1:].rstrip()
body_i=body_i[:body_i.rindex("  };")].rstrip()
body_i=body_i.replace("tenant: tenantForPrint,","tenant,").replace("paid, cashier: cashierName, issuedBy: issuedByOverride ?? (profile?.full_name || undefined),","paid, cashier, issuedBy,").replace("docHeader: docHeaderOverride !== undefined ? docHeaderOverride : buildDocHeader(),","docHeader,")
def dedent(t): return '\n'.join(l[2:] if l.startswith('  ') else l for l in t.split('\n'))
doc=f"""import {{ printTicket80 as printTicket80Shared, printDocumentA4, type PrintTenant }} from '../../lib/print';
import type {{ CartItem, Customer, SalePayment }} from '../../lib/types';

export type PrintableSale = {saleT};
type DocHeader = Record<string, string | null> | null;

export function printSaleTicketDoc(sale: PrintableSale, docHeader: DocHeader, tenant: PrintTenant, cashier: string) {{
{dedent(body_t)}
}}

export function printSaleInvoiceDoc(sale: PrintableSale, docHeader: DocHeader, tenant: PrintTenant, cashier: string, issuedBy?: string) {{
{dedent(body_i)}
}}
"""
open('src/components/cash/saleDocPrint.ts','w').write(doc)
new=f"""  const printSaleTicket = (sale: PrintableSale, docHeaderOverride?: Record<string, string | null> | null) =>
    printSaleTicketDoc(sale, docHeaderOverride !== undefined ? docHeaderOverride : buildDocHeader(), tenantForPrint, cashierName);

  const printSaleInvoice = (sale: PrintableSale, docHeaderOverride?: Record<string, string | null> | null, issuedByOverride?: string) =>
    printSaleInvoiceDoc(sale, docHeaderOverride !== undefined ? docHeaderOverride : buildDocHeader(), tenantForPrint, cashierName, issuedByOverride ?? (profile?.full_name || undefined));
"""
s=s[:a]+new+s[b:]
s=s.replace("import type { CashOpContext } from '../components/cash/cashOpContext';","import type { CashOpContext } from '../components/cash/cashOpContext';\nimport { printSaleTicketDoc, printSaleInvoiceDoc, type PrintableSale } from '../components/cash/saleDocPrint';\nimport { SessionTicketsModal } from '../components/cash/SessionTicketsModal';\nimport { SessionStatsModal } from '../components/cash/SessionStatsModal';")
L=s.split('\n')
def find(pat, start=0):
    for i in range(start,len(L)):
        if pat in L[i]: return i+1
    raise Exception(pat)
g=lambda a,b:'\n'.join(L[a-1:b])
t_st=find("const [ticketsOpen, setTicketsOpen]"); t_st_end=find("const [sessionEncaisse",t_st)
s_st=find("const [statsData, setStatsData]"); s_st_end=find("const [statsExpanded",s_st)
t_h=find("const openTickets = async"); t_h_end=t_h
while L[t_h_end-1]!='  };': t_h_end+=1
s_h=find("const openStats = async"); s_h_end=s_h
while L[s_h_end-1]!='  };': s_h_end+=1
t_j=find("{/* Session tickets list */}"); t_j_end=t_j+1
while L[t_j_end-1]!='      </CashModal>': t_j_end+=1
s_j=find("<CashModal open={statsOpen}"); s_j_end=s_j
while L[s_j_end-1]!='      </CashModal>': s_j_end+=1
print(t_st,t_st_end,s_st,s_st_end,t_h,t_h_end,s_h,s_h_end,t_j,t_j_end,s_j,s_j_end)
def mk(name, st, h, j, flag, opener, extra, sessionProp):
    h=h.replace(opener+" = async () => {", "const load = async () => {\n    if (!tenant) return;",1)
    for x in (h,):
        pass
    def fix(t):
        t=t.replace("tenant!.id","tenant.id").replace("session!.id","bound.sessionId").replace("session.id","bound.sessionId")
        t=re.sub(r"(?<![\w.])(methods|customers)\b",r"bound.\1",t)
        t=t.replace("tenantForPrint","bound.printTenant").replace("cashierName","bound.userName").replace("currentSite?.name || ''","bound.siteName").replace("profile?.full_name || profile?.email || ''","bound.userName")
        return t
    h=fix(h); j=fix(j)
    h=h.replace(f"set{flag}(true); ","").replace(f"set{flag}(true);","")
    j=j.replace("open={"+flag[0].lower()+flag[1:]+"}","open={true}").replace(f"set{flag}(false)","onClose()")
    props="  ctx: CashOpContext;\n"+("  session: CashSession;\n" if sessionProp else "")+"  onClose: () => void;"
    args="{ ctx, "+("session, " if sessionProp else "")+"onClose }"
    return f"""import {{ useEffect, useState }} from 'react';
import {{ supabase }} from '../../lib/supabase';
import {{ useApp }} from '../../context/AppContext';
import {{ usePermissions }} from '../../lib/permissions';
import {{ useToast }} from '../../context/ToastContext';
import {{ formatFCFA, formatDateTime, formatNumber }} from '../../lib/format';
import {{ CashModal }} from '../CashModal';
import {{ isSaleSettlementIncome, type CashMovementKind }} from '../../lib/cashMovements';
import type {{ CashSession }} from '../../lib/types';
import type {{ CashOpContext, SessionSale }} from './cashOpContext';
{extra}
interface Props {{
{props}
}}

export function {name}({args}: Props) {{
  const {{ tenant }} = useApp();
  const {{ can }} = usePermissions();
  const {{ success, error }} = useToast();
  const [bound] = useState(ctx);
{st}

{h}

  useEffect(() => {{ load(); }}, [bound, tenant?.id]);

  return (
    <>
{j}
    </>
  );
}}
"""
tk=mk('SessionTicketsModal', g(t_st+1,t_st_end), g(t_h,t_h_end), g(t_j,t_j_end),'TicketsOpen','  const openTickets',
 "import { printEncaissementTicket80, printDecaissementTicket80, type PrintTenant } from '../../lib/print';\nimport { printSaleTicketDoc, printSaleInvoiceDoc, type PrintableSale } from './saleDocPrint';",False)
tk=tk.replace("  const [bound] = useState(ctx);\n","  const [bound] = useState(ctx);\n  const printSaleTicket = (sale: PrintableSale, docHeader: Record<string, string | null> | null) => printSaleTicketDoc(sale, docHeader, bound.printTenant, bound.userName);\n  const printSaleInvoice = (sale: PrintableSale, docHeader: Record<string, string | null> | null, issuedBy?: string) => printSaleInvoiceDoc(sale, docHeader, bound.printTenant, bound.userName, issuedBy);\n",1)
open('src/components/cash/SessionTicketsModal.tsx','w').write(tk)
sst="  const [statsData, setStatsData] = useState<SessionStats | null>(null);\n  const [sessionRegs, setSessionRegs] = useState<SessionRegularization[]>([]);\n"+g(s_st_end-2,s_st_end)
sh=g(s_h,s_h_end)
sh=sh.replace("    if (!session || !tenant) return;\n","",1)
sh=sh[:sh.rindex("    setLoadingStats(false);")]+"    const { data: regs } = await supabase.from('cash_regularizations').select('id, reg_type, amount, reason, note').eq('cash_session_id', bound.sessionId);\n    setSessionRegs((regs || []).map((r: any) => ({ ...r, amount: Number(r.amount) })));\n    setLoadingStats(false);\n  };"
sj=g(s_j,s_j_end).replace("session as any,","session as any,")
sm=mk('SessionStatsModal', sst, sh, sj,'StatsOpen','  const openStats',"import { printXReport, type SessionStats, type SessionRegularization } from './xReport';",True)
open('src/components/cash/SessionStatsModal.tsx','w').write(sm)
R={(s_j,s_j_end):"      {statsOpen && session && cashCtx && <SessionStatsModal ctx={cashCtx} session={session} onClose={() => setStatsOpen(false)} />}",
   (t_j,t_j_end):"      {ticketsOpen && cashCtx && <SessionTicketsModal ctx={cashCtx} onClose={() => setTicketsOpen(false)} />}",
   (s_h,s_h_end):"  const openStats = () => {\n    if (!session || !tenant) return;\n    setStatsOpen(true);\n  };",
   (t_h,t_h_end):"  const openTickets = () => {\n    if (!session) return;\n    setTicketsOpen(true);\n  };",
   (s_st,s_st_end):"  const [statsOpen, setStatsOpen] = useState(false);",
   (t_st,t_st_end):"  const [ticketsOpen, setTicketsOpen] = useState(false);"}
for (a,b) in sorted(R,reverse=True):
    L[a-1:b]=R[(a,b)].split('\n')
s='\n'.join(L).replace("setOpeningAmount(0); setOpeningNote(''); setStatsData(null);","setOpeningAmount(0); setOpeningNote('');")
open(p,'w').write(s)
