-- Recette après application des deux scripts du lot, dans une transaction annulée.
-- Ne pas lancer avant autorisation de publication. Rôle administrateur SQL requis.
BEGIN;
DO $test$
DECLARE n bigint; expected text; t uuid; u uuid; acc1 text; acc2 text; created jsonb; reversed jsonb; original_id uuid; reverse_id uuid; d numeric; c numeric; n_lines int; old_total numeric; refused boolean:=false; dt date:=(now() AT TIME ZONE 'Africa/Dakar')::date;
BEGIN
 FOR n,expected IN SELECT * FROM (VALUES (1::bigint,'A'),(2,'B'),(26,'Z'),(27,'AA'),(28,'AB'),(52,'AZ'),(53,'BA'),(702,'ZZ'),(703,'AAA')) v(n,expected) LOOP
  IF public._accounting_alpha_code(n) IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Code alphabétique incorrect pour %',n; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.accounting_match_lines l LEFT JOIN public.accounting_match_groups g ON g.tenant_id=l.tenant_id AND g.account_code=l.account_code AND g.group_id=l.group_id WHERE g.group_id IS NULL) THEN RAISE EXCEPTION 'Lettrage sans groupe'; END IF;
 IF EXISTS(SELECT 1 FROM public.accounting_match_groups WHERE code<>public._accounting_alpha_code(sequence_no)) THEN RAISE EXCEPTION 'Code incohérent'; END IF;
 SELECT id INTO STRICT t FROM public.tenants WHERE name='TEST COMPTA';
 SELECT id INTO STRICT u FROM public.profiles WHERE tenant_id=t AND role='admin';
 SELECT code INTO acc1 FROM public.accounts WHERE tenant_id=t AND is_active AND account_type<>'auxiliary' ORDER BY code LIMIT 1;
 SELECT code INTO acc2 FROM public.accounts WHERE tenant_id=t AND is_active AND account_type<>'auxiliary' AND code<>acc1 ORDER BY code LIMIT 1;
 IF acc1 IS NULL OR acc2 IS NULL THEN RAISE EXCEPTION 'Deux comptes de test actifs requis'; END IF;
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 created:=public.create_manual_journal_entry_idempotent(t,'OD',dt,'RECETTE EXT OURNE','TEST',jsonb_build_array(jsonb_build_object('account_code',acc1,'debit',12345,'credit',0),jsonb_build_object('account_code',acc2,'debit',0,'credit',12345)),gen_random_uuid());
 original_id:=(created->>'entry_id')::uuid;
 reversed:=public.reverse_manual_accounting_entry(t,original_id,dt,'Recette annulée');
 reverse_id:=(reversed->>'entry_id')::uuid;
 IF reverse_id IS NULL OR reverse_id=original_id THEN RAISE EXCEPTION 'Identifiant de contrepassation invalide'; END IF;
 SELECT sum(debit),sum(credit),count(*) INTO d,c,n_lines FROM public.journal_lines WHERE tenant_id=t AND entry_id=reverse_id;
 IF d<>12345 OR c<>12345 OR n_lines<>2 THEN RAISE EXCEPTION 'Contrepassation incorrecte'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.journal_lines WHERE tenant_id=t AND entry_id=reverse_id AND account_code=acc1 AND credit=12345) OR NOT EXISTS(SELECT 1 FROM public.journal_lines WHERE tenant_id=t AND entry_id=reverse_id AND account_code=acc2 AND debit=12345) THEN RAISE EXCEPTION 'Sens des lignes incorrect'; END IF;
 SELECT total_debit INTO old_total FROM public.journal_entries WHERE tenant_id=t AND id=original_id AND status='posted';
 IF old_total IS DISTINCT FROM 12345 THEN RAISE EXCEPTION 'Original altéré'; END IF;
 reversed:=public.reverse_manual_accounting_entry(t,original_id,dt,'Recette annulée');
 IF (reversed->>'entry_id')::uuid IS DISTINCT FROM reverse_id OR (reversed->>'already_reversed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Double extourne'; END IF;
 BEGIN PERFORM public.reverse_manual_accounting_entry(t,original_id,dt,'Autre motif'); EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'Cette écriture possède déjà%' THEN refused:=true; ELSE RAISE; END IF; END;
 IF NOT refused THEN RAISE EXCEPTION 'Seconde extourne acceptée'; END IF;
 EXECUTE 'RESET ROLE';
END;
$test$;
ROLLBACK;
