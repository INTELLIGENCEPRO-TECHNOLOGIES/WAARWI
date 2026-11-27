import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { templateError, type EntryTemplate } from './accountingEntryTemplates';

export function useAccountingTemplateRows(tenantId: string, revision: number) {
  const [state, setState] = useState<{ tenantId: string; rows: EntryTemplate[]; error: string; loading: boolean }>(
    { tenantId, rows: [], error: '', loading: true },
  );

  useEffect(() => {
    let alive = true;
    setState(previous => ({
      tenantId, rows: previous.tenantId === tenantId ? previous.rows : [], error: '', loading: true,
    }));
    void (async () => {
      try {
        const rows: EntryTemplate[] = [];
        for (let offset = 0; ; offset += 250) {
          const { data, error } = await supabase.from('accounting_entry_templates')
            .select('id,name,journal_code,description,lines,revision,next_due_on')
            .eq('tenant_id', tenantId).eq('is_active', true).order('name').order('id').range(offset, offset + 249);
          if (error) throw error;
          if (!alive) return;
          rows.push(...(data ?? []));
          if ((data?.length ?? 0) < 250) break;
        }
        if (alive) setState({ tenantId, rows, error: '', loading: false });
      } catch (error) {
        if (alive) setState({ tenantId, rows: [], error: templateError(error, 'Chargement des modèles impossible.'), loading: false });
      }
    })();
    return () => { alive = false; };
  }, [tenantId, revision]);

  return state.tenantId === tenantId ? state : { rows: [], error: '', loading: true };
}

