-- Private wake-up only. No lease token or commercial payload is broadcast.
CREATE POLICY "waarwi_document_edit_private_receive" ON realtime.messages FOR SELECT TO authenticated USING (realtime.topic() = 'waarwi-edit:'||auth.uid()::text);
CREATE OR REPLACE FUNCTION public._notify_document_edit_lease() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid; tenant uuid; typ text; res text; recipients uuid[];
BEGIN
 IF TG_OP='UPDATE' AND OLD.owner_id=NEW.owner_id AND OLD.window_id=NEW.window_id AND OLD.requester_id IS NOT DISTINCT FROM NEW.requester_id AND OLD.request_state IS NOT DISTINCT FROM NEW.request_state THEN RETURN NEW;END IF;
 IF TG_OP='INSERT' THEN tenant:=NEW.tenant_id;typ:=NEW.resource_type;res:=NEW.resource_key;recipients:=ARRAY[NEW.owner_id,NEW.requester_id];
 ELSIF TG_OP='DELETE' THEN tenant:=OLD.tenant_id;typ:=OLD.resource_type;res:=OLD.resource_key;recipients:=ARRAY[OLD.owner_id,OLD.requester_id];
 ELSE tenant:=NEW.tenant_id;typ:=NEW.resource_type;res:=NEW.resource_key;recipients:=ARRAY[OLD.owner_id,NEW.owner_id,OLD.requester_id,NEW.requester_id];END IF;
 FOR uid IN SELECT DISTINCT x FROM unnest(recipients) x WHERE x IS NOT NULL LOOP
  PERFORM realtime.send(jsonb_build_object('tenant_id',tenant,'resource_type',typ,'resource_key',res),'changed','waarwi-edit:'||uid::text,true);
 END LOOP;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public._notify_document_edit_lease() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER document_edit_notify AFTER INSERT OR UPDATE OR DELETE ON public.document_edit_leases FOR EACH ROW EXECUTE FUNCTION public._notify_document_edit_lease();
-- The old public posting routes become internal-only; the browser must present a valid lease.
REVOKE ALL ON FUNCTION public.create_manual_journal_entry_idempotent(uuid,text,date,text,text,jsonb,uuid),public.post_accounting_template_occurrence(uuid,uuid,date,text,text,jsonb) FROM PUBLIC,anon,authenticated;

