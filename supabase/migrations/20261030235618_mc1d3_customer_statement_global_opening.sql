/*
# MC1-D.3 - Releve client : ouverture globale et ajustement agrege (mode multi-caisse)

1. Fonction modifiee : get_customer_statement (signature et cles existantes conservees)
   - Mode desactive, ou appel hors role API : calcul strictement inchange.
   - Mode active (role authenticated) : opening_balance et closing_balance deviennent
     les soldes GLOBAUX du client (identiques pour tous les utilisateurs), obtenus via
     _cs_customer_statement_global (agregats uniquement).
   - Si des operations de la periode ne sont pas visibles par l'utilisateur, une ligne
     agregee unique "Operations d'autres caisses (non detaillees)" (kind 'aggregate')
     est ajoutee en fin de periode ; total_debit / total_credit l'incluent.
   - Nouvelle cle hidden_adjustment (montant net agrege, 0 si rien de masque).
   - Rapprochement : opening + mouvements visibles + hidden_adjustment = closing.
2. Methode
   - Modification chirurgicale de la definition existante (remplacement de texte
     verifie), aucune autre partie du calcul n'est touchee.
*/
DO $mig$
DECLARE
  d text;
  n text;
  a1 text := 'v_result      jsonb;';
  a2 text := $x$v_closing := v_base + (v_result->>'closing_delta')::numeric;$x$;
BEGIN
  d := pg_get_functiondef('public.get_customer_statement(uuid,date,date)'::regprocedure);
  IF position('hidden_adjustment' in d) > 0 THEN RETURN; END IF;
  IF position(a1 in d) = 0 OR position(a2 in d) = 0 THEN
    RAISE EXCEPTION 'get_customer_statement: definition inattendue, migration annulee';
  END IF;
  n := replace(d, a1, a1 || E'\nv_global      jsonb;\nv_hidden      numeric := 0;');
  n := replace(n, a2, a2 || $x$

IF current_user = 'authenticated' AND public._cs_multi_enabled(v_tenant_id) THEN
v_global := public._cs_customer_statement_global(p_customer_id, p_from, p_to);
v_hidden := (v_global->>'closing')::numeric - (v_global->>'opening')::numeric
- ((v_result->>'total_debit')::numeric - (v_result->>'total_credit')::numeric);
v_opening := (v_global->>'opening')::numeric;
v_closing := (v_global->>'closing')::numeric;
IF v_hidden <> 0 THEN
v_result := jsonb_set(v_result, '{rows}', COALESCE(v_result->'rows', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
'ts', CASE WHEN v_to_excl IS NULL THEN now() ELSE LEAST(now(), v_to_excl - interval '1 second') END,
'piece', '', 'label', 'Opérations d''autres caisses (non détaillées)', 'kind', 'aggregate',
'debit', GREATEST(v_hidden, 0), 'credit', GREATEST(-v_hidden, 0),
'cum', v_closing - v_opening, 'affects', true)));
v_result := jsonb_set(v_result, '{total_debit}', to_jsonb((v_result->>'total_debit')::numeric + GREATEST(v_hidden, 0)));
v_result := jsonb_set(v_result, '{total_credit}', to_jsonb((v_result->>'total_credit')::numeric + GREATEST(-v_hidden, 0)));
END IF;
v_result := v_result || jsonb_build_object('hidden_adjustment', v_hidden);
END IF;$x$);
  EXECUTE n;
END;
$mig$;
