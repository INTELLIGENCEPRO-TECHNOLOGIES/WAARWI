/*
# Landing page Phase 1 — content corrections (no schema change)

1. Purpose
- Fix the typo in the tenants stat label ("Businesss accompagnés" -> "entreprises accompagnées").
- Replace the unverifiable "Disponibilité" / 99% uptime stat with a factual,
  verifiable local-support message ("Accompagnement local au Sénégal").
  The uptime_percent value in get_landing_stats() is hardcoded and not measured,
  so we stop presenting it as a fact on the public landing page.
- Fix three business_activity_types descriptions that are empty or repetitive:
  - "bijoux-accessoires": was empty -> add a real description.
  - "pharmacie": was empty -> add a real description.
  - "smartphones": was a duplicate of the name -> replace with a meaningful
    description (IMEI tracking, warranties, per-device stock).

2. Tables touched
- landing_config (single row, id='default') — UPDATE only, no schema change.
- business_activity_types — UPDATE only on three rows matched by slug, no
  schema change.

3. Security
- No RLS or policy changes. Existing policies remain in force:
  - landing_config: public SELECT (anon + authenticated); super_admin writes.
  - business_activity_types: existing SELECT policy unchanged.

4. Idempotence
- All UPDATEs are safe to re-run: they set absolute values for known slugs/ids
  and are guarded by WHERE clauses. Re-running produces the same end state.

5. Notes
- No DROP, no DELETE, no column type changes, no table renames.
- The get_landing_stats() function is NOT modified here; the frontend will
  stop surfacing uptime_percent as a percentage and instead show the new
  textual third stat. The function keeps returning 99.9 for backward
  compatibility but the landing page no longer displays it.
*/

UPDATE landing_config
SET
  stats_label_tenants = 'entreprises accompagnées',
  stats_label_uptime = 'Accompagnement local au Sénégal',
  updated_at = now()
WHERE id = 'default';

UPDATE business_activity_types
SET description = 'Bijoux, montres, sacs et accessoires de mode'
WHERE slug = 'bijoux-accessoires';

UPDATE business_activity_types
SET description = 'Gestion de pharmacie, médicaments et produits de santé'
WHERE slug = 'pharmacie';

UPDATE business_activity_types
SET description = 'Suivi IMEI, garanties et stock par appareil'
WHERE slug = 'smartphones';
