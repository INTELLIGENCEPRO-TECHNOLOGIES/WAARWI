p='src/pages/POS.tsx'
L=open(p).read().split('\n')
def chk(n,s):
    assert s in L[n-1], (n, L[n-1][:80], s)
chk(5216,"Close workflow"); chk(5400,"</CashModal>")
chk(5182,"Regularization"); chk(5214,"</Modal>")
chk(4259,"Return ticket"); chk(4362,"</CashModal>")
chk(3979,"Customer payment"); chk(4167,")}")
chk(3781,"Cash movement"); chk(3977,")}")
chk(2855,"Close workflow"); chk(3062,"};")
chk(2498,"const openReturn"); chk(2594,"}, [returnSales, returnSearch]);")
chk(2144,"const submitMovement"); chk(2355,"};")
chk(2120,"const openMovement"); chk(2128,"};")
chk(2075,"const openCustomerPayment"); chk(2118,"};")
chk(1378,"regOpen"); chk(1384,"sessionRegs")
chk(1331,"closeStep"); chk(1339,"closeIdemRef")
chk(1311,"returnOpen"); chk(1316,"returnLines")
chk(1279,"mvOpen"); chk(1293,"mvPrint")
chk(1296,"custPayOpen"); chk(1308,"custPayIdemRef")
chk(92,"function printXReport"); chk(126,"}")
R={}
R[(5216,5400)]="""      {closeOpen && session && cashCtx && (
        <CashCloseModal ctx={cashCtx} session={session} multiEnabled={!!posCashCtx?.multi_enabled}
          onClose={() => setCloseOpen(false)}
          onClosed={() => {
            setCloseOpen(false); setSession(null); setScreen('open-form');
            setCart([]); setDiscount(0); setCustomer(null);
            setOpeningAmount(0); setOpeningNote(''); setStatsData(null);
            load();
          }} />
      )}"""
R[(5182,5214)]=None
R[(4259,4362)]="""      {returnOpen && cashCtx && (
        <SaleReturnModal ctx={cashCtx} onClose={() => setReturnOpen(false)} onDone={load} />
      )}"""
R[(3979,4167)]="""      {custPayOpen && cashCtx && (
        <CustomerPaymentModal ctx={cashCtx} onClose={() => setCustPayOpen(false)} onDone={load} />
      )}"""
R[(3781,3977)]="""      {mvOpen && cashCtx && (
        <CashMovementModal ctx={cashCtx} onClose={() => setMvOpen(false)} onDone={load} />
      )}"""
R[(2855,3062)]="""  // ─── Close workflow ──────────────────────────────

  const openCloseWorkflow = () => {
    if (!session || !tenant) return;
    if (!can('pos_close_session')) { error('Vous n\\'avez pas la permission de cloturer la session'); return; }
    if (heldCarts.length > 0) {
      error(`Impossible de clôturer : ${heldCarts.length} ticket${heldCarts.length > 1 ? 's' : ''} en attente. Validez ou annulez-les d'abord.`);
      return;
    }
    setCloseOpen(true);
  };"""
R[(2498,2594)]="""  const openReturn = () => {
    if (!session) return;
    if (!can('pos_returns')) { error('Vous n\\'avez pas la permission d\\'effectuer des retours'); return; }
    setReturnOpen(true);
  };"""
R[(2144,2355)]=None
R[(2120,2128)]="""  const openMovement = () => {
    if (!session) { error('Ouvrez d\\'abord la caisse'); return; }
    setMvOpen(true);
  };"""
R[(2075,2118)]="""  const openCustomerPayment = () => {
    if (!session) { error('Ouvrez d\\'abord la caisse'); return; }
    setCustPayOpen(true);
  };"""
for k in [(1378,1384),(1331,1339),(1312,1316),(1297,1308),(1280,1293),(92,126)]: R[k]=None
for (a,b) in sorted(R, reverse=True):
    rep=R[(a,b)]
    L[a-1:b]= [] if rep is None else rep.split('\n')
s='\n'.join(L)
s=s.replace("import { CashSupervision } from '../components/CashSupervision';","""import { CashSupervision } from '../components/CashSupervision';
import { CashMovementModal } from '../components/cash/CashMovementModal';
import { CustomerPaymentModal } from '../components/cash/CustomerPaymentModal';
import { SaleReturnModal } from '../components/cash/SaleReturnModal';
import { CashCloseModal } from '../components/cash/CashCloseModal';
import { printXReport } from '../components/cash/xReport';
import type { CashOpContext } from '../components/cash/cashOpContext';""",1)
anchor="  const [session, setSession] = useState<CashSession | null>(hasPosCache ? posCache.session : null);\n"
assert anchor in s
s=s.replace(anchor, anchor+"""  const cashCtx: CashOpContext | null = session ? {
    mode: 'personal', sessionId: session.id, siteId: session.site_id,
    registerLabel: '', operatorName: cashierName, siteName: currentSite?.name || '',
    userName: cashierName, printTenant: tenantForPrint, methods, customers,
  } : null;
""",1)
a=s.index("  useEffect(() => {\n    if (!tenant || !currentSite?.id) { setExpenseCats([]); return; }")
b=s.index("  }, [tenant?.id, currentSite?.id]);\n",a)+len("  }, [tenant?.id, currentSite?.id]);\n")
s=s[:a]+s[b:].lstrip('\n')
open(p,'w').write(s)
