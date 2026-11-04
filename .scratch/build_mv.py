import re
st=open('.scratch/mv_state.txt').read()
sb=open('.scratch/mv_submit.txt').read()
jx=open('.scratch/mv_jsx.txt').read()
st=st.replace("  const [mvOpen, setMvOpen] = useState(false);\n","")
sb=sb.replace("  const submitMovement = async () => {\n    if (!session || !currentSite) return;\n","  const submitMovement = async () => {\n")
old_rpc_start=sb.index("    const { data, error: e } = await supabase.rpc('record_cash_movement', {")
old_rpc_end=sb.index("    });\n",old_rpc_start)+len("    });\n")
rpc=sb[old_rpc_start:old_rpc_end]
args=rpc[rpc.index('{',rpc.index('record_cash_movement'))+1:rpc.rindex('}')]
args=args.replace("p_cash_session_id: session.id,","").replace("p_site_id: currentSite.id,","")
new=("    const common = {"+args+"};\n"
"    const { data, error: e } = bound.mode === 'supervision'\n"
"      ? await supabase.rpc('cash_supervision_record_movement', { p_session_id: bound.sessionId, ...common, p_idempotency_key: opKey })\n"
"      : await supabase.rpc('record_cash_movement', { p_cash_session_id: bound.sessionId, p_site_id: bound.siteId, ...common });\n")
sb=sb[:old_rpc_start]+new+sb[old_rpc_end:]
sb=sb.replace("tenantForPrint as PrintTenant","bound.printTenant").replace("cashier: cashierName","cashier: bound.userName")
sb=sb.replace("setMvOpen(false);\n      load();","onDone();\n      onClose();").replace("      load();\n    } else","      setOpKey(newIdempotencyKey());\n      onDone();\n    } else")
jx=jx.replace("setMvOpen(false)","onClose()").replace("{methods","{bound.methods").replace("{customers","{bound.customers")
jx=re.sub(r"\bcustomers\b(?=\s*\n?\s*\.)", "bound.customers", jx)
jx=re.sub(r"(?<![\w.])methods\b", "bound.methods", jx)
out=f"""import {{ useEffect, useState }} from 'react';
import {{ Loader2, Check, Printer }} from 'lucide-react';
import {{ supabase }} from '../../lib/supabase';
import {{ fetchPrepayAvailable }} from '../../lib/customerCredit';
import {{ useApp }} from '../../context/AppContext';
import {{ usePermissions }} from '../../lib/permissions';
import {{ useToast }} from '../../context/ToastContext';
import {{ formatFCFA }} from '../../lib/format';
import {{ CashModal }} from '../CashModal';
import {{ SearchableSelect }} from '../SearchableSelect';
import {{ printEncaissementTicket80 }} from '../../lib/print';
import {{ newIdempotencyKey }} from '../../lib/cashSession';
import type {{ Customer, PaymentMethod }} from '../../lib/types';
import type {{ CashOpContext }} from './cashOpContext';

interface Props {{
  ctx: CashOpContext;
  onClose: () => void;
  onDone: () => void;
}}

export function CashMovementModal({{ ctx, onClose, onDone }}: Props) {{
  const {{ tenant }} = useApp();
  const {{ can }} = usePermissions();
  const {{ success, error }} = useToast();
  const [bound] = useState(ctx);
  const [opKey, setOpKey] = useState(newIdempotencyKey);
  const [expenseCats, setExpenseCats] = useState<{{ id: string; name: string }}[]>([]);
{st}

  useEffect(() => {{
    setMvMethod(bound.methods[0] || null);
    supabase.rpc('get_effective_expense_categories', {{ p_site_id: bound.siteId, p_include_inactive: false }})
      .then(({{ data }}) => setExpenseCats((data as {{ id: string; name: string }}[]) || []));
  }}, [bound]);

{sb}

  return (
{jx}
  );
}}
"""
open('src/components/cash/CashMovementModal.tsx','w').write(out)
