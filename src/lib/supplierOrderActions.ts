import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { useApp } from '../context/AppContext';
import { usePermissions } from './permissions';

export const RECEIVED_STATUSES = ['received', 'partial'];
const EDITABLE_STATUSES = ['draft', 'sent', 'confirmed'];

export function useSupplierOrderRights() {
  const { tenant, dataTick } = useApp();
  const { can } = usePermissions();
  const [settings, setSettings] = useState({ allow_edit: false, allow_delete: false });

  useEffect(() => {
    if (!tenant?.id) return;
    let cancelled = false;
    supabase
      .from('document_settings')
      .select('allow_edit, allow_delete')
      .eq('tenant_id', tenant.id)
      .eq('doc_type', 'supplier_order')
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setSettings({ allow_edit: data?.allow_edit === true, allow_delete: data?.allow_delete === true });
      });
    return () => { cancelled = true; };
  }, [tenant?.id, dataTick]);

  const canEditReceived = settings.allow_edit && can('edit_supplier_orders');
  const canDelete = settings.allow_delete && can('delete_supplier_orders');

  const canEditStatus = (status: string | undefined) => {
    if (!status) return false;
    if (RECEIVED_STATUSES.includes(status)) return canEditReceived;
    return EDITABLE_STATUSES.includes(status);
  };

  return { canEditReceived, canDelete, canEditStatus };
}

function friendlyError(message: string | undefined, fallback: string) {
  const m = message || '';
  if (m.includes('NEGATIVE_STOCK_FORBIDDEN')) {
    return "Impossible : une partie des articles reçus a déjà été vendue ou sortie du stock, et le stock négatif est interdit pour ce magasin.";
  }
  if (m.includes('ORDER_HAS_PAYMENTS')) {
    return 'Des paiements fournisseur sont liés à cette commande. Supprimez-les d’abord, puis réessayez.';
  }
  return m || fallback;
}

export async function revertSupplierOrderReception(orderId: string): Promise<string | null> {
  const { error } = await supabase.rpc('revert_supplier_order_reception', { p_order_id: orderId });
  return error ? friendlyError(error.message, "Erreur lors de l'annulation de la réception") : null;
}

export async function deleteSupplierOrder(orderId: string): Promise<string | null> {
  const { error } = await supabase.rpc('delete_supplier_order', { p_order_id: orderId });
  return error ? friendlyError(error.message, 'Erreur lors de la suppression') : null;
}
