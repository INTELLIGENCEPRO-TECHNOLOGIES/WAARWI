import re
L=open('src/pages/POS.tsx').read().split('\n')
g=lambda a,b:'\n'.join(L[a-1:b])
xr=g(92,126)
stats_type=g(1340,1349)
stats_type=stats_type[stats_type.index('{'):stats_type.rindex('}')+1]
xfile=f"""import type {{ CashSession }} from '../../lib/types';
import type {{ ControlLine }} from '../../lib/cashClose';
import type {{ CashMovementKind }} from '../../lib/cashMovements';
import {{ printXReport80, type PrintTenant }} from '../../lib/print';

export type SessionStats = {stats_type};

export type SessionRegularization = {{ id?: string; reg_type: string; amount: number; reason: string; note: string }};

export {xr}
"""
open('src/components/cash/xReport.ts','w').write(xfile)
st=g(1331,1339)+"\n"+g(1379,1384)
st+="\n  const [statsData, setStatsData] = useState<SessionStats | null>(null);"
st=st.replace("useState<{ id?: string; reg_type: string; amount: number; reason: string; note: string }[]>([])","useState<SessionRegularization[]>([])")
op=g(2857,2948)
op=op.replace("  const openCloseWorkflow = async () => {\n    if (!session || !tenant) return;","  const loadControl = async () => {\n    if (!tenant) return;")
i=op.index("    if (heldCarts.length > 0) {"); j=op.index("    setCloseStep('control');")
op=op[:i]+op[j:]
op=op.replace("    setCloseOpen(true);\n","").replace("closeIdemRef.current = (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);","closeIdemRef.current = newIdempotencyKey();")
op=op.replace("session.site_id","bound.siteId").replace("session.id","bound.sessionId").replace("Number(session.opening_amount)","Number(openingAmount)")
op=op.replace("user_name: profile?.full_name || profile?.email || null","user_name: bound.userName || null")
mid=g(2950,3061)
mid=mid.replace("    if (!session || !tenant || !profile) return;\n    if (regAmount <= 0)","    if (!tenant || !profile) return;\n    if (regAmount <= 0)")
i=mid.index("    setSavingReg(true);\n    const { error: e } = await supabase.from('cash_regularizations').insert({"); j=mid.index("    if (e) { error(e.message); return; }",i)
mid=mid[:i]+"""    setSavingReg(true);
    const { data, error: e } = bound.mode === 'supervision'
      ? await supabase.rpc('cash_supervision_add_regularization', {
          p_session_id: bound.sessionId, p_reg_type: regType, p_amount: regAmount,
          p_reason: regReason, p_note: regNote, p_idempotency_key: regKeyRef.current,
        }).then(r => ({ data: r.data ? { id: (r.data as any).regularization_id } : null, error: r.error }))
      : await supabase.from('cash_regularizations').insert({
          tenant_id: tenant.id, cash_session_id: bound.sessionId,
          reg_type: regType, amount: regAmount, reason: regReason, note: regNote, user_id: profile.id,
        }).select('id').maybeSingle();
    setSavingReg(false);
"""+mid[j:]
mid=mid.replace("    setRegOpen(false); setRegAmount(0);","    regKeyRef.current = newIdempotencyKey();\n    setRegOpen(false); setRegAmount(0);")
mid=mid.replace("      const { error: e } = await supabase.from('cash_regularizations').delete().eq('id', reg.id);","      const { error: e } = bound.mode === 'supervision'\n        ? await supabase.rpc('cash_supervision_delete_regularization', { p_session_id: bound.sessionId, p_regularization_id: reg.id })\n        : await supabase.from('cash_regularizations').delete().eq('id', reg.id);")
mid=mid.replace("    if (!session || !tenant) return;\n    if (!can('pos_close_session'))","    if (!tenant) return;\n    if (!can('pos_close_session'))")
mid=mid.replace("    if (posCashCtx?.multi_enabled) {","    if (bound.mode === 'supervision' || multiEnabled) {")
mid=mid.replace("session.id","bound.sessionId")
i=mid.index("    if (statsData) {")
mid=mid[:i]+"""    if (statsData) {
      printXReport(
        { ...session, closing_note: closingNote } as any, controlLines, statsData, sessionRegs,
        bound.printTenant, bound.userName, bound.siteName
      );
    }
    success('Caisse clôturée');
    onClosed();
  };"""
mid=re.sub(r"(?<![\w.])methods\b","bound.methods",mid)
op=re.sub(r"(?<![\w.])methods\b","bound.methods",op)
jreg=g(5183,5214); jclose=g(5217,5400)
jclose=jclose.replace("open={closeOpen}","open={true}").replace("setCloseOpen(false)","onClose()")
out=f"""import {{ useEffect, useRef, useState }} from 'react';
import {{ AlertTriangle, ArrowLeft, Check, ChevronRight, Loader2, Lock, Plus, Trash2, X }} from 'lucide-react';
import {{ supabase }} from '../../lib/supabase';
import {{ useApp }} from '../../context/AppContext';
import {{ usePermissions }} from '../../lib/permissions';
import {{ useToast }} from '../../context/ToastContext';
import {{ formatFCFA }} from '../../lib/format';
import {{ Modal }} from '../Modal';
import {{ CashModal }} from '../CashModal';
import {{ newIdempotencyKey }} from '../../lib/cashSession';
import {{ buildCloseControlLines, type ControlLine }} from '../../lib/cashClose';
import {{ isSaleSettlementIncome, type CashMovementKind }} from '../../lib/cashMovements';
import type {{ CashSession }} from '../../lib/types';
import type {{ CashOpContext }} from './cashOpContext';
import {{ printXReport, type SessionStats, type SessionRegularization }} from './xReport';

type CloseStep = 'control' | 'regularize' | 'confirm';

interface Props {{
  ctx: CashOpContext;
  session: CashSession;
  multiEnabled: boolean;
  onClose: () => void;
  onClosed: () => void;
}}

export function CashCloseModal({{ ctx, session, multiEnabled, onClose, onClosed }}: Props) {{
  const {{ tenant, profile }} = useApp();
  const {{ can }} = usePermissions();
  const {{ success, error }} = useToast();
  const [bound] = useState(ctx);
  const openingAmount = session.opening_amount;
  const enabledModules: string[] = Array.isArray((tenant as any)?.enabled_modules) ? (tenant as any).enabled_modules : [];
  const hasModule = (m: string) => enabledModules.includes(m);
  const [regOpen, setRegOpen] = useState(false);
  const regKeyRef = useRef<string>(newIdempotencyKey());
{st}

{op}

  useEffect(() => {{ loadControl(); }}, [bound]);

{mid}

  return (
    <>
{jreg}

{jclose}
    </>
  );
}}
"""
out=out.replace("if (!can('pos_close_session'))","if (bound.mode === 'personal' && !can('pos_close_session'))")
open('src/components/cash/CashCloseModal.tsx','w').write(out)
