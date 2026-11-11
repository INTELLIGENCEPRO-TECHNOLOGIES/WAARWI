# Backup / Restore System v2 — Runbook

**CONFIDENTIAL — INTELLIGENCEPRO ONLY**

## Architecture Overview

The v2 backup/restore system replaces the legacy hardcoded approach with a
**registry-driven, checksummed, activation-locked** architecture.

### Core Tables

| Table | Purpose |
|-------|---------|
| `_br_table_registry` | Central registry of all tenant-scoped tables (89+ entries) |
| `_br_tenant_activation` | Per-tenant activation lock (fail-closed) |
| `tenant_backups` | Backup storage, extended with v2 columns |

### Functions

| Function | Access | Description |
|----------|--------|-------------|
| `br_check_schema_drift()` | authenticated | Compares registry vs pg_catalog |
| `br_create_backup(label, kind)` | authenticated | Registry-driven backup with SHA-256 checksums |
| `br_preflight_restore(backup_id)` | authenticated | Non-destructive pre-restore validation |
| `br_restore_backup(backup_id)` | authenticated (+ activation lock) | Atomic fail-fast restore |
| `br_reset_operations()` | authenticated (+ activation lock) | Operational data reset |
| `br_import_payload(payload)` | authenticated (+ activation lock) | Import from external JSON |

### Error Codes

| Code | Meaning |
|------|---------|
| BR-001 | No tenant context |
| BR-002 | Schema drift detected |
| BR-003 | Backup not found |
| BR-004 | Tenant mismatch |
| BR-005 | Preflight failed |
| BR-006 | Safety backup creation failed |
| BR-007 | Safety backup verification failed |
| BR-008 | Post-restore integrity check failed |
| BR-010 | Advisory lock contention |
| BR-011 | Activation lock not enabled |
| BR-012 | Foreign tenant data in import |

---

## Validation Checklist

### Pre-deployment

- [ ] Run `SELECT br_check_schema_drift()` — must return `drift_detected: false`
- [ ] Verify registry count: `SELECT count(*) FROM _br_table_registry` — expect 89+ rows
- [ ] Verify legacy backups preserved: `SELECT count(*) FROM tenant_backups WHERE status = 'legacy'`
- [ ] Verify all legacy functions revoked:
  ```sql
  SELECT proname, proacl
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND proname IN ('tenant_create_backup', 'tenant_restore_backup',
                    'tenant_restore_from_payload', 'reset_tenant_data',
                    'tenant_reset_operations', '_apply_tenant_metadata',
                    'tenant_run_due_auto_backup');
  ```
  Confirm no `anon` or `authenticated` in proacl.

### Post-deployment — Test with a test tenant

1. **Create backup:**
   ```sql
   SELECT br_create_backup('Test backup', 'manual');
   ```
   Expect: `success: true`, `format_version: 2`, checksums present.

2. **Check schema drift:**
   ```sql
   SELECT br_check_schema_drift();
   ```
   Expect: `drift_detected: false`.

3. **Preflight without activation:**
   ```sql
   SELECT br_preflight_restore('<backup_id>');
   ```
   Expect: `viable: false`, issue code `ACTIVATION_LOCKED`.

4. **Enable activation (service role only):**
   ```sql
   INSERT INTO _br_tenant_activation (tenant_id, enabled, enabled_at)
   VALUES ('<tenant_id>', true, now())
   ON CONFLICT (tenant_id) DO UPDATE SET enabled = true, enabled_at = now();
   ```

5. **Preflight with activation:**
   Expect: `viable: true` (or warnings only).

6. **Restore:**
   ```sql
   SELECT br_restore_backup('<backup_id>');
   ```
   Expect: `success: true`, `integrity_verified: true`, `safety_backup_id` present.

7. **Reset operations:**
   ```sql
   SELECT br_reset_operations();
   ```
   Expect: `success: true`, safety backup created, only operation/audit tables deleted.

### Security Verification

- [ ] `SELECT br_restore_backup(...)` fails from anon key
- [ ] All `br_*` functions fail for unauthenticated calls
- [ ] `reset_tenant_data(uuid)` is not callable by authenticated role
- [ ] `_apply_tenant_metadata(uuid, jsonb)` is not callable by authenticated role
- [ ] `_br_tenant_activation` is not writable by authenticated role

---

## Activation Lock Management

The activation lock is **fail-closed**: destructive operations are blocked unless
explicitly enabled per tenant.

**Enable** (service role / platform admin only):
```sql
INSERT INTO _br_tenant_activation (tenant_id, enabled, enabled_at, enabled_by)
VALUES ('<tenant_id>', true, now(), '<admin_user_id>')
ON CONFLICT (tenant_id) DO UPDATE
SET enabled = true, enabled_at = now(), enabled_by = '<admin_user_id>', disabled_at = null;
```

**Disable** (after maintenance):
```sql
UPDATE _br_tenant_activation
SET enabled = false, disabled_at = now()
WHERE tenant_id = '<tenant_id>';
```

---

## Registry Maintenance

When a new tenant-scoped table is added to the schema, it **must** be registered:
```sql
INSERT INTO _br_table_registry (table_name, tenant_link, category, restore_order, reset_behavior)
VALUES ('new_table', 'direct', 'operation', 70, 'delete');
```

Failure to register will cause `br_create_backup` to fail with `BR-002: Schema drift detected`.

### Table Categories

| Category | Backup | Reset Behavior | Example |
|----------|--------|---------------|---------|
| structure | Yes | Preserved | articles, customers, sites |
| operation | Yes | Deleted | sales, cash_movements |
| audit | Yes | Deleted | site_change_log |
| backup_system | No | Preserved | tenant_backups |
| platform | No | Preserved | plans, profiles |

### Restore Order

| Order | Content |
|-------|---------|
| 10 | Root tables (FK only to tenants) |
| 20 | FK to order-10 tables |
| 30 | FK to order-20 tables |
| 40 | FK to articles, vehicle_models |
| 50 | Session containers |
| 60 | Document headers |
| 70 | Line items |
| 80 | Post-transaction / audit |
| 90 | Deepest children |

---

## Excluded Tables — Justifications

| Table | Reason |
|-------|--------|
| `tenants` | Identity table — overwriting would break tenant |
| `profiles` | Auth-linked via trigger on auth.users |
| `tenant_subscriptions` | Platform-managed billing state |
| `subscription_action_tokens` | Platform-managed security tokens |
| `tenant_backups` | Backup data must not overwrite itself |
| `tenant_backup_settings` | Schedule config preserved across restores |
| `_br_table_registry` | System metadata |
| `_br_tenant_activation` | Activation lock metadata |
| `plans` | Global platform data |
| `business_activity_types` | Global platform data |
| `master_catalogs` | Global platform data |
| `master_catalog_categories` | Global platform data |
| `master_catalog_items` | Global platform data |
| `platform_login_config` | Global platform data |
| `landing_config` | Global platform data |
| `app_releases` | Global platform data |
| `platform_events` | Global platform data |
| `tenant_messages` | Cross-tenant messaging |
| `tenant_message_reads` | Cross-tenant messaging |

### Non-existent tables (confirmed absent from schema)

These tables do NOT exist as standalone tables:
- `warranties`, `warranty_items` — never created
- `sale_cancellations` — cancellation tracked via columns on `sales`
- `site_doc_header_config` — stored as jsonb column, not a table
- `a4_header_config` — stored as jsonb column on tenants/sites

---

## Lot B — Moteur durable de capture (INACTIF)

Migration : `20261110231500_lot_b_durable_capture_engine_inactive.sql`. Aucun cron, aucun worker, aucune Edge Function
n'appelle ce moteur. Le chemin v2 (`backup-scheduler`) est inchangé. Réinitialisation / restauration / import restent
bloqués (BR020). `capture_ready` n'est **ni restaurable ni « verified »**.

### Machine à états (`_br_backup_jobs.status`)

```
pending --claim--> leased --mark_processing--> processing --capture_run--> capture_ready   (lot C : export/publication)
   ^                 |                            |
   |                 +---- bail expiré (recover_expired) ----+--> pending (attempts < max) | failed (attempts >= max)
   +---------------- _br_job_fail transitoire (backoff exp.) +--> failed (permanent, BRJ-05x)
capture_ready --verify_staging KO--> pending (STAGING_LOST, génération superseded)
pending|capture_ready|bail expiré --_br_job_cancel--> cancelled
Terminaux : succeeded (lot C, exige tenant_backups.status = verified), failed, cancelled.
```

Générations (`_br_capture_generations.status`) : `capturing -> capture_ready | superseded | failed`,
`capture_ready -> superseded`. Terminales : `superseded`, `failed`. Identité et contenu capturé immuables (BRJ-070).

### Garanties serveur

| Garantie | Mécanisme |
|---|---|
| Un job par (tenant, type, période) | `UNIQUE (tenant_id, backup_kind, period_key)` + `ON CONFLICT DO NOTHING` |
| Une capture active par tenant | index unique partiel `uq_br_backup_jobs_one_active_per_tenant` |
| Limite globale (2) | `slot_no` : index unique partiel + FK vers `_br_capture_slots` ; NOT EXISTS = simple pré-filtre |
| Numéro de prise | `claim_fence` incrémenté à chaque prise + jeton aléatoire neuf |
| Ancien worker rejeté | `_br_job_lock_owned(..., true)` : jeton identique ET bail non expiré, sous `FOR UPDATE`, pour renew / processing / capture / fail / success |
| Pas d'écriture dans une ancienne génération | triggers BRJ-072/073 ; `UNIQUE (job_id, claim_fence)` |
| Cloisonnement | RLS sans politique, aucun droit anon/authenticated ; service_role : SELECT seul ; FK composites (tenant_id, …) |

### Cohérence

`_br_capture_run` lit toutes les tables du registre (direct + indirect) dans **une seule instruction**
`INSERT … SELECT … UNION ALL` : PostgreSQL utilise un instantané unique par instruction, quel que soit le niveau
d'isolation (READ COMMITTED inclus). Ordre déterministe : `row_number() OVER (ORDER BY <colonnes PK>)` ; sans PK :
`to_jsonb(ligne)::text` (`order_key = row_text`). Empreintes : md5 par table puis globale.

### Durées et capacité (aucune promesse de capacité)

- Exécution : voir « Lot B.1 » ci-dessous (exécuteur serveur ; la limite de durée est fixée par la commande
  avant la capture, plus par la fonction). `work_mem = 64 MB`.
- Bail : 60–3600 s ; capture refusée si bail restant < limite + 30 s (BRJ-041).
- Dépassement : l'instruction est annulée, la transaction de capture entière est annulée (aucune génération
  partielle) ; classement « capacité » et arrêt après `max_capacity_failures` (Lot B.1).
- Ressources temporaires : staging LOGGED ≈ taille JSON du tenant (ordre de grandeur du `payload` v2) + WAL
  correspondant + index PK. Purgé à la supersession. Libération physique par autovacuum.
- Reprise : nouvelle prise => nouveau fence => nouvelle génération ; l'ancienne est `superseded` et son staging supprimé.
- Limite connue : un tenant dont la capture dépasse 300 s ne peut pas être capturé par ce moteur tel quel
  (découpage par lots prévu au lot C).

### Tests

Voir `tests/backup-v3/README.md` (suites versionnées, résultats en section Lot B.1).
- **Protocole de benchmark (non exécuté, jamais en production)** : cloner le schéma en préproduction ; générer un tenant
  synthétique au volume du plus gros tenant actuel puis ×10 ; mesurer durée de `_br_capture_run`, taille staging,
  WAL généré (`pg_current_wal_lsn` avant/après), pic mémoire ; 3 répétitions ; variante UNLOGGED mesurée séparément
  (une table UNLOGGED est vidée après crash : la détection `STAGING_LOST` couvre ce cas, aucune durabilité n'est revendiquée).

## Lot B.1 — Exécution de la capture hors requête HTTP (INACTIF)

Migration `20261110234624_lot_b1_server_capture_executor_inactive`.

### Chemin d'exécution
1. HTTP (service_role) : `_br_v3_request_capture(tenant, période)` — enregistre une demande, ne capture rien.
2. pg_cron (rôle postgres, futur job `br_capture_executor`, chaque minute) exécute une seule chaîne :
   `SELECT _br_capture_executor_claim('pg_cron'); COMMIT; SET LOCAL statement_timeout = '<limite>s'; SELECT _br_capture_executor_run();`
   - transaction 1 : réservation atomique (`_br_job_claim`, SKIP LOCKED) + `processing`, validée par le COMMIT ;
   - transaction 2 : limite fixée AVANT la capture ; capture en une instruction (instantané unique) ;
     succès => `capture_ready` (jamais `verified`, `restorable: false`) ; échec => enregistré avec code, classe, tentative.
3. `_br_capture_run` et les fonctions exécuteur ne sont exécutables par aucun rôle d'API.

### Valeurs mesurées en production (lecture seule, 10/11/2026)
- `statement_timeout` global 120 s (fichier de configuration) ; anon 3 s ; authenticated 8 s ; authenticator 8 s +
  lock_timeout 8 s ; postgres et service_role : aucun réglage propre ; lock_timeout / idle_in_transaction / transaction_timeout globaux 0.
- pg_cron 1.6.4, `use_background_workers = off` (connexion libpq localhost), `max_running_jobs` 32, jobs en rôle postgres.
- Historique cron 14 j : durée max observée 0,34 s. **Durée maximale réelle d'un job pg_cron : NON MESURÉE.**
- Hypothèse (démontrée sur PostgreSQL 17.6 local, pas sur le pg_cron de production) : une session cron reçoit 120 s
  sauf `SET LOCAL` dans la commande ; le `SET` d'une fonction ne prolonge pas l'instruction appelante.

### Bail, verrous, reprise
- Bail = `capture_timeout_seconds` + `lease_margin_seconds` (900 + 120 s par défaut, ≤ 3600) : la capture se termine
  (succès ou annulation) avant l'expiration ; aucun renouvellement n'est nécessaire pendant l'instruction.
- Pendant la capture, la ligne du job est verrouillée (FOR UPDATE) jusqu'à la fin de la transaction 2 :
  la reprise (`_br_jobs_recover_expired`) et la réservation l'ignorent (SKIP LOCKED, sans attente) ; renouvellement ou
  annulation depuis une autre session attendent le verrou (borner par `lock_timeout`).
- Arrêt de l'exécuteur : rollback => verrou libéré, aucune génération ; reprise après expiration du bail avec fence + 1.
- Ancien exécuteur après reprise : jeton et fence refusés (BRJ-010 / BRJ-071), état `lease_lost`, rien n'est écrit.

### Classes d'échec
- `transient` : réessai avec backoff jusqu'à `max_attempts`.
- `capacity` (dépassement de durée, SQLSTATE 53xxx/54000) : `capacity_failures` + 1, BRJ-043 ;
  `failed` définitif dès `max_capacity_failures` (2) — pas de relance indéfinie.
- `permanent` (BRJ-05x, 42xxx, 22023, P0002) : `failed` immédiatement.
- Limite connue : un tenant dont la capture dépasse la limite échoue en `capacity` ; le découpage cohérent est hors lot.

### Activation (NON faite — à exécuter explicitement, après les prérequis)
```sql
UPDATE public._br_capture_executor_config SET enabled = true;   -- éventuellement capture_timeout_seconds
SELECT public._br_capture_executor_schedule(true);               -- crée le job cron
-- désactivation : SELECT public._br_capture_executor_schedule(false); UPDATE ... SET enabled = false;
```

### Tests (`tests/backup-v3/`)
- Exécutés : mécanique PostgreSQL 17.6 (7/7) ; scénarios moteur PGlite 16.4 (40/40) et PostgreSQL 17.6 (40/40) ;
  multi-sessions PostgreSQL 17.6 C1–C6 (6/6) : course de réservation, capture longue pendant écritures métier et
  attente des verrous, dépassement de durée, exécuteur tué, ancien exécuteur après reprise, exécuteur désactivé.
- Préparés, NON exécutés : `pg_cron_isolated_check.sql` (pg_cron réel, projet isolé uniquement) ; benchmark volume
  actuel et ×10 (protocole ci-dessus).

## Lot C — Export par blocs et publication vérifiée (INACTIF)

Migration `20261111005055_lot_c_block_export_verified_publication_inactive` ; fonction Edge `backup-export-v3`
(enregistrée dans `supabase/config.toml`, **non déployée**). Aucun cron, `_br_v3_export_config` : `enabled`,
`offsite_enabled`, `cleanup_delete_enabled` = false. Les archives v3 vivent dans `_br_v3_archives` (jamais dans
`tenant_backups`) : écrans, téléchargements et restauration v2 inchangés ; `restorable` contraint à false.

### Chaîne
`capture_ready` → `exporting` → `verifying` → `publishing` → `succeeded` (job) / `verified` (archive), ou `failed`.
Bail d'export (jeton + fence) porté par l'archive, vérifié sous verrou (job puis archive) à chaque écriture ;
liaison job ↔ génération `capture_ready` ↔ `claim_fence` contrôlée (BRV-010/011/012). Publication : manifeste
recalculé en base (référence serveur, BRV-040), tous blocs vérifiés (BRV-033), puis `_br_capture_supersede(gen,
'archived_v3')` dans la même transaction (staging libéré seulement après publication).

### Limites (défauts)
Bloc cible 4 MiB (octets réels, `octet_length`) ; ligne max 16 MiB (au-delà : BRV-021, aucune troncature) ;
100 000 lignes max par bloc ; 8 blocs par invocation ; bail 300 s ; 30 reprises sans progrès (BRV-046) ;
objets ≤ 40 MiB (bucket privé `tenant-backups-v3`, aucune politique).

### Format v3 — contrat de lecture pour le lot D
- Objet bloc `.wbr3` : `WBR3` (4 octets) | longueur d'en-tête uint32 BE (≤ 4096) | en-tête JSON public
  (`container`, `container_version`, `algorithm`, `nonce_hex`, puis la liaison `kind`, `tenant_id`, `archive_id`,
  `generation_id`, `block_no`, `key_id` — informative, non utilisée pour l'AAD) | AES-256-GCM(gzip(clair)), nonce aléatoire 12 octets, tag 16 octets.
- AAD = `waarwi-br3|<kind>|<tenant>|<archive>|<generation>|<block_no>|<key_id>` — reconstruit par le lecteur à
  partir des valeurs attendues (manifeste de référence), jamais depuis l'en-tête de l'objet.
- Clair d'un bloc : ligne 1 = JSON `{format:"waarwi-br-block", format_version:3, tenant_id, archive_id,
  generation_id, block_no, table, ord_from, ord_to, rows}` ; puis une ligne par enregistrement = texte jsonb
  PostgreSQL exact (`row_data::text`), terminée par `\n`. Le lecteur NE DOIT PAS passer par `JSON.parse` en
  nombres JS : réinjecter le texte en base (`::jsonb` puis `jsonb_populate_record`) pour préserver numeric, bigint,
  dates, NULL, Unicode, échappements, JSON imbriqué.
- Manifeste `.wbr3m` (kind `manifest`, block_no 0) : `waarwi-br-archive-manifest` v3, `tables` (y compris tables
  vides, `rows: 0`, `blocks: 0` ; table absente = absente de la liste), `blocks` (plages, tailles, SHA-256 clair et
  stocké, nonce), totaux, `restorable: false`, `integrity_only: true`.
- Paquet de téléchargement : `waarwi-v3-<archive_id>/manifest.wbr3m` + `blocks/NNNNNN.wbr3`, servi entrée par
  entrée (`download_list` / `download_entry`), contenu chiffré uniquement, après `br_v3_download_authorize`
  (propriétaire/super_admin du tenant, BR-404/BR-409).
- Clés : `key_id` enregistré par archive ; trousseau historique via `BACKUP_ENCRYPTION_KEYRING_JSON`.

### Reprise
Chiffré non envoyé → bloc régénéré avec nouveau nonce ; envoyé non validé → objet orphelin, nouvel `attempt_id` ;
blocs terminés non clôturés → reprise par réservation ; manifeste envoyé non publié → nouveau manifeste et nonce ;
publié → idempotent. Unicité (key_id, nonce) en base. Nettoyage : `_br_v3_cleanup_plan` (plan seul, aucune
suppression automatique).

### Hors site LWS v3
`_br_v3_offsite_transfers` : pending / in_progress / confirmed / failed ; bloc par bloc avec relecture distante
(SHA-256 + taille), manifeste en dernier ; un échec ne supprime jamais l'archive primaire. Testé sur serveur WebDAV
simulé uniquement.

### Activation (NON faite)
Prérequis : secret `BACKUP_V3_CRON_SECRET`, déploiement de `backup-export-v3`, test sur tenant de test.
```sql
UPDATE public._br_v3_export_config SET enabled = true;          -- export
UPDATE public._br_v3_export_config SET offsite_enabled = true;  -- copie LWS v3
```
Aucun cron n'est créé par ce lot.

## Lot D — Restauration et réinitialisation sûres (INACTIF)

Rien n'est activé : `_br_restore_config.enabled = false`, les points d'entrée publics (`br_restore_backup`,
`br_reset_operations`, `br_import_payload`) appellent toujours `_br_assert_destructive_available()` (BR020) ;
les anciennes fonctions (`tenant_reset_operations`, `tenant_restore_backup`, `tenant_restore_from_payload`,
`reset_tenant_data`) ne sont exécutables ni par anon ni par authenticated (vérifié en production). Les fonctions `_br_rs_*` sont réservées au serveur
(EXECUTE retiré à PUBLIC/anon/authenticated) et vérifient en plus l'acteur (propriétaire du tenant ou
super_admin de ce tenant). Périmètre : **tout le tenant** — « Cette opération concerne tous les magasins de votre
entreprise. » Aucune réinitialisation par magasin.

### Contrat d'exécution
1. `_br_rs_request_restore(tenant, acteur, 'v2'|'v3', source)` / `_br_rs_request_reset(tenant, acteur)` : un seul
   travail actif par tenant (index unique) ; double demande → BRR-002.
2. `_br_rs_claim` : bail + fence (reprise propre après crash, l'ancien worker est rejeté BRR-061).
3. Chargement progressif en zone privée `_br_restore_rows` : v2 table par table depuis `tenant_backups.payload` ;
   v3 bloc par bloc (`_br_rs_v3_load_block`) après déchiffrement côté worker avec la liaison AAD attendue ; le
   serveur recalcule le SHA-256 du texte clair reconstruit (en-tête + lignes) et le compare au bloc vérifié.
   Les lignes voyagent en texte et sont converties en jsonb côté SQL (numeric/bigint jamais via Number JS).
   Une table/un bloc partiel est rechargé à la reprise ; `_br_rs_abandon` vide la zone de préparation.
4. `_br_rs_verify` (aucune mutation métier) : tables attendues, nombres de lignes, empreintes (v3 : formule
   capture lot B ; v2 : sha256 trié du lot v2), tenant de chaque ligne, colonnes inconnues, types
   (`jsonb_populate_record`), NOT NULL sans défaut, unicité des clés, références internes à l'archive et
   externes (auth.users, profiles, catalogue). Toute anomalie → `failed`, jamais un avertissement.
5. `_br_rs_enter_maintenance` (transaction validée séparément), puis `_br_rs_swap` ou `_br_rs_reset_run`,
   puis `_br_rs_release` (toujours, succès ou échec ; `_br_rs_recover` après crash).

### Maintenance et sérialisation
- Déclencheur `_br_gate` (BEFORE ROW, premier par ordre de nom) sur chaque table du registre : verrou consultatif
  **partagé** par tenant + refus si maintenance active (BR-503) ou si la transaction a commencé avant la
  dernière libération (BR-504, données remplacées pendant la transaction : réessayer).
- Swap/reset : verrou consultatif **exclusif** du tenant (`lock_timeout` 60 s) → attend les écritures engagées ;
  les autres tenants ne sont pas concernés (clé par tenant).
- Le drapeau expire (`maintenance_ttl_seconds`) ; `_br_rs_recover` libère les maintenances orphelines.

### Contexte privilégié
`_br_restore_context` (privé, aucun GRANT) : ligne insérée par le swap, liée à `pg_backend_pid()` et au
`txid_current()` de la transaction, supprimée avant COMMIT. Elle n'est jamais visible d'une autre transaction.
`_br_restore_bypass()` ne renvoie vrai que dans cette transaction. Aucun GUC, aucun paramètre libre,
aucune désactivation globale (`session_replication_role` non utilisé).
Les déclencheurs métier des tables du registre sont recréés avec `WHEN (NOT _br_restore_bypass())`
(`_br_lotd_install_hooks`, non exécuté en production) : sessions clôturées (closed_by conservé), caisse par
défaut à la création d'un magasin/session, consommation automatique des acomptes, recalcul des soldes
fournisseurs, garde de stock négatif, journal de statut des commandes en ligne, limites de plan, numérotation
automatique (les numéros archivés sont conservés), touches updated_at. Les contraintes (FK, CHECK, UNIQUE) ne
sont jamais contournées. Swap/reset refusés si les crochets ne sont pas installés (BRR-070).

### Restauration atomique (une transaction)
1. Verrou exclusif, contrôle de dérive, empreinte de schéma identique à la vérification.
2. Sauvegarde de sécurité `_br_restore_safety` (toutes les tables du registre du tenant, une instruction),
   empreintes recalculées sur le vivant et comparées → sinon BRR-050, aucune mutation.
3. Mémorisation de `profiles.default_site_id`.
4. Suppression du tenant table par table (ordre décroissant) : les lignes absentes de l'archive disparaissent
   (pas d'upsert). Tables « historiquement absentes » : contenu actuel réinséré depuis la sauvegarde de sécurité
   (structures) ou vidé (opérations).
5. Insertion par ordre croissant (vagues pour les auto-références), seconde passe des colonnes différées.
6. Compteurs : `tenant_doc_counters.last_number = max(courant, archivé, numéros présents)` ;
   `accounting_sequences.last_number = max(courant, archivé)`. Aucun numéro réutilisé.
7. `profiles.default_site_id` remis s'il pointe vers un magasin existant, sinon NULL (signalé).
8. Contrôles avant COMMIT : nombre de lignes et empreinte de chaque table archivée = archive (compteurs :
   ≥ archivé, écart justifié). Toute erreur → retour arrière complet, travail `failed`.
Identités et droits : `profiles`, `auth.*` non touchés ; `role_permissions`, caisses et affectations suivent
l'archive (v3) ou sont conservés (v2 sans ces tables).

### Archives historiques
| Format | Traitement |
|---|---|
| v1 (`_tenant`, jun.–juil. 2026) | refusé avant mutation (BRR-010) |
| v2 | même zone de préparation et mêmes contrôles que v3 |
| v3 | archive `verified`, manifeste authentifié, blocs vérifiés |
Classement d'une table du registre absente de l'archive :
- table présente avec 0 ligne → table vide (restaurée vide) ;
- absente et inscrite au registre **après** la date de l'archive → historiquement absente (caisses, affectations,
  réglages multi-caisse, `cash_supervision_requests`, `expense_category_site_settings`,
  `accounting_account_mappings`) ;
- absente et inscrite **avant** → archive incomplète, bloquant (BRR-020).
Règle v2 sans `cash_registers` : chaque magasin reçoit sa caisse par défaut (`CAISSE-1`, même règle que le
déclencheur de création de magasin) si elle n'existe pas, et les sessions sans `cash_register_id` y sont
rattachées.

### Réinitialisation — comportements historiques et choix
| Fonction | Comportement |
|---|---|
| `reset_tenant_data` (ancienne) | supprime aussi des structures (comptes MT, clients MT, catégories) — écarté |
| `tenant_reset_operations` | supprime opérations + lots + compteurs, remet à zéro stocks, coffres, comptes MT, clients, fournisseurs |
| `br_reset_operations` (v2) | supprime les tables `delete` du registre (compteurs inclus), ne remet aucun solde à zéro — soldes sans justificatif |
Choix lot D (le seul compatible avec « aucun solde sans opérations » et « pas de réutilisation de numéros ») :
- **supprimées** : tables `reset_behavior='delete'` du registre (opérations, audit), **sauf `tenant_doc_counters`**,
  plus `stock_lots` (quantités issues des réceptions, comme `tenant_reset_operations`) ;
- **remises à zéro** : `customers.balance`, `suppliers.balance`, `vaults.current_balance`, `mt_accounts.balance`,
  `stock_levels.quantity` (valorisation = 0 faute de lots) ; acomptes et imputations supprimés ;
- **conservées** : articles, magasins, caisses, affectations, profils, permissions, réglages, plan comptable,
  `tenant_doc_counters`, `accounting_sequences`, IPM (organismes, conventions, bénéficiaires),
  `mt_init_balances`/`mt_init_status` (soldes d'ouverture déclarés, structure).
- Contrôles avant COMMIT : tables supprimées vides, soldes à zéro, empreinte des structures inchangée (hors
  colonnes remises à zéro et updated_at) → aucune disparition par cascade.

### Formats d'empreinte v2 acceptés
| Variante | `checksums[table]` | Contrôle |
|---|---|---|
| sha256 (lot v2) | 64 hex | sha256 trié du lot v2 |
| md5 historique | 32 hex | `md5(string_agg(md5(row_to_json(t)::text), '' ORDER BY id))` |
| vide | `''` / absent (table vide) | nombre de lignes seul |
Toute autre longueur ou empreinte divergente → `failed` avant mutation (BRR-03x), puis exécution refusée (BRR-003).

### Codes d'erreur principaux
BRR-002 travail déjà actif · BRR-003 état incompatible (exécution avant `prepared`, rejeu d'un travail terminé) ·
BRR-004 seconde exécution · BRR-010 format refusé · BRR-020 archive incomplète · BRR-041 manifeste invalide ·
BRR-050 dérive avant swap · BRR-061 fence périmée · BRR-070 déclencheur métier non gardé ·
BRR-074 verrou exclusif non obtenu · BRR-077 ligne préparée non vérifiée · BRR-403 acteur non autorisé ·
BR-503 maintenance · BR-504 transaction antérieure au remplacement.

### Livraison (état exact)
- Migration : `supabase/migrations_review/20261112090000_lot_d_safe_restore_reset_inactive.sql`
  (hors `supabase/migrations/`), **non appliquée en production** (0 fonction `_br_rs_`, pas de `_br_restore_jobs`).
- Fonction `backup-export-v3` : correctif du chargeur (limite du manifeste en clair `MANIFEST_PLAIN_MAX`) dans
  `core.ts`, **redéployé** ; la version déployée n'expose toujours aucune action de restauration.
- Périmètre : `scope = 'all_sites'`. Restauration et réinitialisation **par magasin reportées** à un chantier distinct.
- Interface : confirmations « Cette opération concerne tous les magasins de votre entreprise. », boutons
  désactivés (`DESTRUCTIVE_SUSPENDED = true`).
- Validation locale (PostgreSQL 17 embarqué, données synthétiques) : D0–D8 9/9 ; suite complète verte ;
  plpgsql_check 2.8.2 sur 35 fonctions : 0 erreur, 0 avertissement.

### Activation (lot ultérieur, non faite)
1. Appliquer la migration via l'outil de migration (plpgsql_check y est rejoué).
2. Exécuter `_br_lotd_install_hooks()` hors pointe, vérifier BRR-070 levé.
3. Ajouter à `backup-export-v3` l'action de chargement, puis redéployer.
4. Lever BR020 et passer `_br_restore_config.enabled = true` seulement après validation métier.

## Lot E — Intégration serveur restauration / réinitialisation (INACTIF)

### Livraison (état exact)
- Migration : `supabase/migrations_review/20261112100000_lot_e_restore_reset_server_integration_inactive.sql`,
  **non appliquée** (aucun projet isolé accessible). Fonctions `_br_rs_api_*` (service_role uniquement),
  procédure `_br_rs_executor_next` et `_br_rs_executor_schedule` (aucun rôle API).
- `backup-export-v3` : actions de restauration dans `core.ts` / `index.ts`, **non déployées volontairement**.
  Acteur lu depuis le jeton, jamais le tenant depuis le corps ; cron sans acteur limité au chargement.
- Règle BRR-080 : exécution refusée sans archive v3 vérifiée capturée après la création du job.
- Interface : `DESTRUCTIVE_SUSPENDED = true` conservé ; BR020 conservé.

### Validation locale
- E0–E6 7/7 (refus de rôles, BR020, chaîne cron → export → manifeste après vérification, isolation,
  restauration v3 avec diff limité aux compteurs, rollback, reset 2 magasins + nouvelle vente).
- E7 20 000 clients + 20 000 ventes : 40 116 lignes, 31 blocs ; capture 1,1 s ; export + vérification 1,7 s ;
  chargement 2,9 s ; sauvegarde de sécurité 0,8 + 1,2 s ; bascule 7,9 s ; pic mémoire Node 213 Mo.
  Export interrompu avant vérification : archive non vérifiée, aucun manifeste, reprise jusqu'à vérifiée.
- ×10 (200 000) : non concluant dans la fenêtre de 18 minutes.

### Recette sur projet isolé (accès manquant)
Requis : projet Supabase de test distinct (ref + clé service), bucket privé `tenant-backups-v3`, secrets
`BACKUP_ENCRYPTION_KEY_ID`, `BACKUP_ENCRYPTION_KEY_B64`, `BACKUP_V3_CRON_SECRET`, pg_cron + pg_net,
espace WebDAV LWS de test (facultatif). Vérifier la ref du projet avant toute écriture, puis :
1. Appliquer D puis E ; `select _br_lotd_install_hooks();`.
2. Déployer `backup-export-v3` ; activer `_br_v3_export_config`, `_br_capture_executor_config`,
   `select _br_capture_executor_schedule(true);` et la tâche cron d'export.
3. Exécuter `tests/backup-v3/pg_cron_isolated_check.sql`, puis la chaîne E2–E6 via HTTP.

### Ordre de déploiement production (deux décisions séparées)
Décision 1 — sauvegardes v3 : étapes 1 et 2 ci-dessus, BR020 maintenu.
Décision 2 — opérations destructives globales : lever BR020, `_br_restore_config.enabled = true`,
`select _br_rs_executor_schedule(true);`, puis brancher l'interface (`DESTRUCTIVE_SUSPENDED = false`).

### Procédure d'arrêt
`select _br_rs_executor_schedule(false);` ; `select _br_capture_executor_schedule(false);` ;
configs `enabled = false` ; `select _br_rs_recover();` ; `_br_rs_abandon` pour chaque job ouvert ;
BR020 remis en place.
