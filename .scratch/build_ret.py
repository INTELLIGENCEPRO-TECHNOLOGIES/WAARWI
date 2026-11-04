import re
L=open('src/pages/POS.tsx').read().split('\n')
g=lambda a,b:'\n'.join(L[a-1:b])
typ=g(67,81).replace("type SessionSale","export type SessionSale")
p='src/components/cash/cashOpContext.ts'
s=open(p).read()
if 'SessionSale' not in s: open(p,'w').write(s+"\n"+typ+"\n")
st=g(1312,1316)
opn=g(2498,2541)
rest=g(2543,2595)+"\n"+g(2597,2601)
opn=opn.replace("  const openReturn = async () => {\n","  const loadReturnSales = async () => {\n").replace("    setReturnOpen(true); setReturnSelected(null); setReturnLines([]);\n","")
opn=opn.replace("tenant!.id","tenant.id").replace("session!.id","bound.sessionId").replace("    if (!can('pos_returns'))","    if (!tenant) return;\n    if (!can('pos_returns'))")
rest=rest.replace("    if (!returnSelected || !tenant || !currentSite || !session) return;","    if (!returnSelected || !tenant) return;")
i=rest.index("      const requestId = crypto.randomUUID();"); j=rest.index("      if (rpcErr) throw")
rest=rest[:i]+"""      const items = lines.map(l => ({ sale_item_id: l.sale_item_id, quantity: l.quantity }));
      const { data: result, error: rpcErr } = bound.mode === 'supervision'
        ? await supabase.rpc('cash_supervision_sale_return', {
            p_session_id: bound.sessionId,
            p_sale_id: returnSelected.id,
            p_items: items,
            p_reason: 'Retour au POS',
            p_refund_method: null,
            p_idempotency_key: opKey,
          })
        : await supabase.rpc('process_sale_return', {
            p_sale_id: returnSelected.id,
            p_site_id: bound.siteId,
            p_cash_session_id: bound.sessionId,
            p_items: items,
            p_reason: 'Retour au POS',
            p_refund_now: true,
            p_restock: true,
            p_request_id: opKey,
          });

"""+rest[j:]
rest=rest.replace("tenantForPrint, cashierName","bound.printTenant, bound.userName").replace("      setReturnOpen(false);\n","      setOpKey(newIdempotencyKey());\n      onClose();\n").replace("      load();\n","      onDone();\n")
jx=g(4260,4362).replace("open={returnOpen}","open={true}").replace("setReturnOpen(false)","onClose()")
out=f"""import {{ useEffect, useMemo, useState }} from 'react';
import {{ supabase }} from '../../lib/supabase';
import {{ useApp }} from '../../context/AppContext';
import {{ usePermissions }} from '../../lib/permissions';
import {{ useToast }} from '../../context/ToastContext';
import {{ formatFCFA, formatDateTime }} from '../../lib/format';
import {{ CashModal }} from '../CashModal';
import {{ printReturnTicket80 as printReturnTicket80Shared }} from '../../lib/print';
import {{ newIdempotencyKey }} from '../../lib/cashSession';
import type {{ CashOpContext, SessionSale }} from './cashOpContext';

interface Props {{
  ctx: CashOpContext;
  onClose: () => void;
  onDone: () => void;
}}

export function SaleReturnModal({{ ctx, onClose, onDone }}: Props) {{
  const {{ tenant }} = useApp();
  const {{ can }} = usePermissions();
  const {{ success, error }} = useToast();
  const [bound] = useState(ctx);
  const [opKey, setOpKey] = useState(newIdempotencyKey);
{st}

{opn}

  useEffect(() => {{ loadReturnSales(); }}, [bound]);

{rest}

  return (
{jx}
  );
}}
"""
open('src/components/cash/SaleReturnModal.tsx','w').write(out)
