import re
L=open('src/pages/POS.tsx').read().split('\n')
g=lambda a,b:'\n'.join(L[a-1:b])
st=g(1297,1308)
op=g(2076,2088)
lu=g(2090,2118)
cp=g(2238,2302)
dr=g(2304,2355)
jx=g(3981,4166)
st=st.replace("  const custPayIdemRef = useRef<string>(crypto.randomUUID());","  const custPayIdemRef = useRef<string>(newIdempotencyKey());")
# init from openCustomerPayment body
op=op.replace("    if (!session) { error('Ouvrez d\\'abord la caisse'); return; }\n","").replace("    setCustPayOpen(true);\n","").replace("methods[0]","bound.methods[0]")
lu=lu.replace("    if (!tenant) return;\n","    if (!tenant) return;\n")
# customer payment rpc
cp=cp.replace("    if (!session || !custPayCustomer","    if (!custPayCustomer")
i=cp.index("    if (custPaySaleId === '__balance__') {"); j=cp.index("    if (e) { setCustPaySubmitting(false)")
cp=cp[:i]+"""    if (bound.mode === 'supervision') {
      const { data: rpcData, error: rpcErr } = await supabase.rpc('cash_supervision_customer_payment', {
        p_session_id: bound.sessionId,
        p_customer_id: custPayCustomer.id,
        p_sale_id: custPaySaleId && custPaySaleId !== '__balance__' ? custPaySaleId : null,
        p_balance: custPaySaleId === '__balance__',
        p_payment_method_id: custPayMethod.id,
        p_method_name: custPayMethod.name,
        p_amount: custPayAmount,
        p_reference: custPayRef,
        p_idempotency_key: custPayIdemRef.current,
      });
      e = rpcErr;
      if (!rpcErr && rpcData) pieceNumber = (rpcData as any).piece_number || null;
    } else if (custPaySaleId === '__balance__') {"""+cp[i+len("    if (custPaySaleId === '__balance__') {"):j].replace("session.id","bound.sessionId")+cp[j:]
cp=cp.replace("custPayIdemRef.current = crypto.randomUUID();","custPayIdemRef.current = newIdempotencyKey();")
dr=dr.replace("    if (!session || !currentSite || !tenant) return;\n","    if (!tenant) return;\n")
i=dr.index("    const { error: e } = await supabase.rpc('record_cash_movement', {"); j=dr.index("    });\n",i)+len("    });\n")
dr=dr[:i]+"""    const common = {
      p_kind: 'income',
      p_amount: paidAmount,
      p_reason: reason,
      p_note: '',
      p_reference: refValue,
      p_customer_id: null,
      p_payment_method_id: custPayMethod.id,
      p_method_name: custPayMethod.name,
    };
    const { error: e } = bound.mode === 'supervision'
      ? await supabase.rpc('cash_supervision_record_movement', { p_session_id: bound.sessionId, ...common, p_expense_category_id: null, p_idempotency_key: custPayIdemRef.current })
      : await supabase.rpc('record_cash_movement', { p_cash_session_id: bound.sessionId, p_site_id: bound.siteId, ...common });
"""+dr[j:]
dr=dr.replace("    setCustPayRef('');\n    load();","    setCustPayRef('');\n    custPayIdemRef.current = newIdempotencyKey();\n    onDone();")
for blk in ('cp','dr'):
    pass
cp=cp.replace("    load();\n  };","    onDone();\n  };")
both=cp+"\n\n"+dr
both=both.replace("tenantForPrint as PrintTenant","bound.printTenant").replace("cashier: cashierName","cashier: bound.userName")
jx=jx.replace("setCustPayOpen(false)","onClose()")
jx=re.sub(r"(?<![\w.])methods\b","bound.methods",jx)
jx=re.sub(r"(?<![\w.])customers\b","bound.customers",jx)
out=f"""import {{ useRef, useState }} from 'react';
import {{ supabase }} from '../../lib/supabase';
import {{ useApp }} from '../../context/AppContext';
import {{ usePermissions }} from '../../lib/permissions';
import {{ useToast }} from '../../context/ToastContext';
import {{ formatFCFA }} from '../../lib/format';
import {{ CashModal }} from '../CashModal';
import {{ printEncaissementTicket80 }} from '../../lib/print';
import {{ newIdempotencyKey }} from '../../lib/cashSession';
import type {{ Customer, PaymentMethod }} from '../../lib/types';
import type {{ CashOpContext }} from './cashOpContext';

interface Props {{
  ctx: CashOpContext;
  onClose: () => void;
  onDone: () => void;
}}

export function CustomerPaymentModal({{ ctx, onClose, onDone }}: Props) {{
  const {{ tenant }} = useApp();
  const {{ can }} = usePermissions();
  const {{ success, error }} = useToast();
  const [bound] = useState(ctx);
{st.replace("useState<PaymentMethod | null>(null)","useState<PaymentMethod | null>(bound.methods[0] || null)")}

{lu}

{both}

  return (
{jx}
  );
}}
"""
open('src/components/cash/CustomerPaymentModal.tsx','w').write(out)
print(op)
