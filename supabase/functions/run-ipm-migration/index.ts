import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) {
    return new Response(JSON.stringify({ error: "No SUPABASE_DB_URL" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sql = postgres(dbUrl, { ssl: "require" });

  const results: { step: string; ok: boolean; error?: string }[] = [];

  const migrations: { name: string; query: string }[] = [
    {
      name: "ipm_organismes",
      query: `CREATE TABLE IF NOT EXISTS ipm_organismes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        code text,
        nom text NOT NULL,
        adresse text,
        telephone text,
        email text,
        contact_facturation text,
        delai_paiement_jours integer DEFAULT 30,
        conditions_paiement text,
        observations text,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
    },
    {
      name: "ipm_organismes_rls",
      query: `ALTER TABLE ipm_organismes ENABLE ROW LEVEL SECURITY`,
    },
    {
      name: "ipm_organismes_policies",
      query: `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_organismes' AND policyname='select_own_ipm_organismes') THEN
          CREATE POLICY "select_own_ipm_organismes" ON ipm_organismes FOR SELECT TO authenticated USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_organismes' AND policyname='insert_own_ipm_organismes') THEN
          CREATE POLICY "insert_own_ipm_organismes" ON ipm_organismes FOR INSERT TO authenticated WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_organismes' AND policyname='update_own_ipm_organismes') THEN
          CREATE POLICY "update_own_ipm_organismes" ON ipm_organismes FOR UPDATE TO authenticated USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid())) WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_organismes' AND policyname='delete_own_ipm_organismes') THEN
          CREATE POLICY "delete_own_ipm_organismes" ON ipm_organismes FOR DELETE TO authenticated USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
      END $$`,
    },
    {
      name: "ipm_conventions",
      query: `CREATE TABLE IF NOT EXISTS ipm_conventions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        organisme_id uuid NOT NULL REFERENCES ipm_organismes(id) ON DELETE CASCADE,
        nom text NOT NULL,
        code text,
        date_debut date,
        date_fin date,
        taux_defaut numeric(5,2) NOT NULL DEFAULT 80,
        plafond_facture numeric(12,2),
        plafond_jour numeric(12,2),
        plafond_mois numeric(12,2),
        plafond_annuel numeric(12,2),
        ordonnance_obligatoire boolean NOT NULL DEFAULT false,
        bon_prise_en_charge_obligatoire boolean NOT NULL DEFAULT false,
        numero_bon_obligatoire boolean NOT NULL DEFAULT false,
        numero_ordonnance_obligatoire boolean NOT NULL DEFAULT false,
        medecin_prescripteur_obligatoire boolean NOT NULL DEFAULT false,
        matricule_obligatoire boolean NOT NULL DEFAULT true,
        mode_arrondi text NOT NULL DEFAULT 'round',
        mode_calcul text NOT NULL DEFAULT 'ligne_par_ligne',
        application_plafond text NOT NULL DEFAULT 'apres_calcul',
        forcer_montant_ipm boolean NOT NULL DEFAULT false,
        justification_si_force boolean NOT NULL DEFAULT true,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
    },
    {
      name: "ipm_conventions_rls",
      query: `ALTER TABLE ipm_conventions ENABLE ROW LEVEL SECURITY`,
    },
    {
      name: "ipm_conventions_policies",
      query: `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_conventions' AND policyname='select_own_ipm_conventions') THEN
          CREATE POLICY "select_own_ipm_conventions" ON ipm_conventions FOR SELECT TO authenticated USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_conventions' AND policyname='insert_own_ipm_conventions') THEN
          CREATE POLICY "insert_own_ipm_conventions" ON ipm_conventions FOR INSERT TO authenticated WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_conventions' AND policyname='update_own_ipm_conventions') THEN
          CREATE POLICY "update_own_ipm_conventions" ON ipm_conventions FOR UPDATE TO authenticated USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid())) WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_conventions' AND policyname='delete_own_ipm_conventions') THEN
          CREATE POLICY "delete_own_ipm_conventions" ON ipm_conventions FOR DELETE TO authenticated USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
      END $$`,
    },
    {
      name: "ipm_beneficiaires",
      query: `CREATE TABLE IF NOT EXISTS ipm_beneficiaires (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        organisme_id uuid NOT NULL REFERENCES ipm_organismes(id),
        convention_id uuid REFERENCES ipm_conventions(id) ON DELETE SET NULL,
        matricule text,
        nom_titulaire text,
        lien_titulaire text DEFAULT 'lui_meme',
        date_debut_couverture date,
        date_fin_couverture date,
        plafond_individuel numeric(12,2),
        statut text NOT NULL DEFAULT 'actif',
        observations text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
    },
    {
      name: "ipm_beneficiaires_rls",
      query: `ALTER TABLE ipm_beneficiaires ENABLE ROW LEVEL SECURITY`,
    },
    {
      name: "ipm_beneficiaires_policies",
      query: `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_beneficiaires' AND policyname='select_own_ipm_beneficiaires') THEN
          CREATE POLICY "select_own_ipm_beneficiaires" ON ipm_beneficiaires FOR SELECT TO authenticated USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_beneficiaires' AND policyname='insert_own_ipm_beneficiaires') THEN
          CREATE POLICY "insert_own_ipm_beneficiaires" ON ipm_beneficiaires FOR INSERT TO authenticated WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_beneficiaires' AND policyname='update_own_ipm_beneficiaires') THEN
          CREATE POLICY "update_own_ipm_beneficiaires" ON ipm_beneficiaires FOR UPDATE TO authenticated USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid())) WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_beneficiaires' AND policyname='delete_own_ipm_beneficiaires') THEN
          CREATE POLICY "delete_own_ipm_beneficiaires" ON ipm_beneficiaires FOR DELETE TO authenticated USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
      END $$`,
    },
    {
      name: "ipm_ventes",
      query: `CREATE TABLE IF NOT EXISTS ipm_ventes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        organisme_id uuid NOT NULL REFERENCES ipm_organismes(id),
        beneficiaire_id uuid REFERENCES ipm_beneficiaires(id),
        convention_id uuid REFERENCES ipm_conventions(id),
        sale_id uuid,
        invoice_id uuid,
        date_vente date NOT NULL DEFAULT CURRENT_DATE,
        part_ipm numeric(12,2) NOT NULL DEFAULT 0,
        part_client numeric(12,2) NOT NULL DEFAULT 0,
        montant_total numeric(12,2) NOT NULL DEFAULT 0,
        statut text NOT NULL DEFAULT 'en_attente',
        bordereau_id uuid,
        facture_ipm_id uuid,
        notes text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
    },
    {
      name: "ipm_ventes_rls",
      query: `ALTER TABLE ipm_ventes ENABLE ROW LEVEL SECURITY`,
    },
    {
      name: "ipm_ventes_policies",
      query: `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_ventes' AND policyname='select_own_ipm_ventes') THEN
          CREATE POLICY "select_own_ipm_ventes" ON ipm_ventes FOR SELECT TO authenticated USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_ventes' AND policyname='insert_own_ipm_ventes') THEN
          CREATE POLICY "insert_own_ipm_ventes" ON ipm_ventes FOR INSERT TO authenticated WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_ventes' AND policyname='update_own_ipm_ventes') THEN
          CREATE POLICY "update_own_ipm_ventes" ON ipm_ventes FOR UPDATE TO authenticated USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid())) WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_ventes' AND policyname='delete_own_ipm_ventes') THEN
          CREATE POLICY "delete_own_ipm_ventes" ON ipm_ventes FOR DELETE TO authenticated USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
      END $$`,
    },
    {
      name: "ipm_bordereaux",
      query: `CREATE TABLE IF NOT EXISTS ipm_bordereaux (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        organisme_id uuid NOT NULL REFERENCES ipm_organismes(id),
        numero text NOT NULL,
        periode_debut date NOT NULL,
        periode_fin date NOT NULL,
        total_part_ipm numeric(12,2) NOT NULL DEFAULT 0,
        nombre_factures integer NOT NULL DEFAULT 0,
        statut text NOT NULL DEFAULT 'brouillon',
        notes text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(tenant_id, numero)
      )`,
    },
    {
      name: "ipm_bordereaux_rls",
      query: `ALTER TABLE ipm_bordereaux ENABLE ROW LEVEL SECURITY`,
    },
    {
      name: "ipm_bordereaux_policies",
      query: `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_bordereaux' AND policyname='select_own_ipm_bordereaux') THEN
          CREATE POLICY "select_own_ipm_bordereaux" ON ipm_bordereaux FOR SELECT TO authenticated USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_bordereaux' AND policyname='insert_own_ipm_bordereaux') THEN
          CREATE POLICY "insert_own_ipm_bordereaux" ON ipm_bordereaux FOR INSERT TO authenticated WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_bordereaux' AND policyname='update_own_ipm_bordereaux') THEN
          CREATE POLICY "update_own_ipm_bordereaux" ON ipm_bordereaux FOR UPDATE TO authenticated USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid())) WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_bordereaux' AND policyname='delete_own_ipm_bordereaux') THEN
          CREATE POLICY "delete_own_ipm_bordereaux" ON ipm_bordereaux FOR DELETE TO authenticated USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
      END $$`,
    },
    {
      name: "ipm_factures",
      query: `CREATE TABLE IF NOT EXISTS ipm_factures (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        organisme_id uuid NOT NULL REFERENCES ipm_organismes(id),
        bordereau_id uuid REFERENCES ipm_bordereaux(id),
        numero text NOT NULL,
        date_facture date NOT NULL DEFAULT CURRENT_DATE,
        date_echeance date,
        montant_total numeric(12,2) NOT NULL DEFAULT 0,
        montant_regle numeric(12,2) NOT NULL DEFAULT 0,
        reste_a_payer numeric(12,2) NOT NULL DEFAULT 0,
        statut text NOT NULL DEFAULT 'emise',
        notes text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(tenant_id, numero)
      )`,
    },
    {
      name: "ipm_factures_rls",
      query: `ALTER TABLE ipm_factures ENABLE ROW LEVEL SECURITY`,
    },
    {
      name: "ipm_factures_policies",
      query: `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_factures' AND policyname='select_own_ipm_factures') THEN
          CREATE POLICY "select_own_ipm_factures" ON ipm_factures FOR SELECT TO authenticated USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_factures' AND policyname='insert_own_ipm_factures') THEN
          CREATE POLICY "insert_own_ipm_factures" ON ipm_factures FOR INSERT TO authenticated WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_factures' AND policyname='update_own_ipm_factures') THEN
          CREATE POLICY "update_own_ipm_factures" ON ipm_factures FOR UPDATE TO authenticated USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid())) WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_factures' AND policyname='delete_own_ipm_factures') THEN
          CREATE POLICY "delete_own_ipm_factures" ON ipm_factures FOR DELETE TO authenticated USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
      END $$`,
    },
    {
      name: "ipm_reglements",
      query: `CREATE TABLE IF NOT EXISTS ipm_reglements (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        organisme_id uuid NOT NULL REFERENCES ipm_organismes(id),
        facture_id uuid REFERENCES ipm_factures(id),
        date_reglement date NOT NULL DEFAULT CURRENT_DATE,
        montant_recu numeric(12,2) NOT NULL,
        montant_attendu numeric(12,2),
        ecart numeric(12,2) DEFAULT 0,
        mode_reglement text NOT NULL DEFAULT 'virement',
        reference text,
        notes text,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
    },
    {
      name: "ipm_reglements_rls",
      query: `ALTER TABLE ipm_reglements ENABLE ROW LEVEL SECURITY`,
    },
    {
      name: "ipm_reglements_policies",
      query: `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_reglements' AND policyname='select_own_ipm_reglements') THEN
          CREATE POLICY "select_own_ipm_reglements" ON ipm_reglements FOR SELECT TO authenticated USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_reglements' AND policyname='insert_own_ipm_reglements') THEN
          CREATE POLICY "insert_own_ipm_reglements" ON ipm_reglements FOR INSERT TO authenticated WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_reglements' AND policyname='update_own_ipm_reglements') THEN
          CREATE POLICY "update_own_ipm_reglements" ON ipm_reglements FOR UPDATE TO authenticated USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid())) WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_reglements' AND policyname='delete_own_ipm_reglements') THEN
          CREATE POLICY "delete_own_ipm_reglements" ON ipm_reglements FOR DELETE TO authenticated USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
      END $$`,
    },
    {
      name: "ipm_rejets",
      query: `CREATE TABLE IF NOT EXISTS ipm_rejets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        vente_ipm_id uuid REFERENCES ipm_ventes(id),
        facture_id uuid REFERENCES ipm_factures(id),
        organisme_id uuid NOT NULL REFERENCES ipm_organismes(id),
        date_rejet date NOT NULL DEFAULT CURRENT_DATE,
        montant_rejete numeric(12,2) NOT NULL,
        motif text NOT NULL,
        statut text NOT NULL DEFAULT 'nouveau',
        action_corrective text,
        notes text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`,
    },
    {
      name: "ipm_rejets_rls",
      query: `ALTER TABLE ipm_rejets ENABLE ROW LEVEL SECURITY`,
    },
    {
      name: "ipm_rejets_policies",
      query: `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_rejets' AND policyname='select_own_ipm_rejets') THEN
          CREATE POLICY "select_own_ipm_rejets" ON ipm_rejets FOR SELECT TO authenticated USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_rejets' AND policyname='insert_own_ipm_rejets') THEN
          CREATE POLICY "insert_own_ipm_rejets" ON ipm_rejets FOR INSERT TO authenticated WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_rejets' AND policyname='update_own_ipm_rejets') THEN
          CREATE POLICY "update_own_ipm_rejets" ON ipm_rejets FOR UPDATE TO authenticated USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid())) WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_rejets' AND policyname='delete_own_ipm_rejets') THEN
          CREATE POLICY "delete_own_ipm_rejets" ON ipm_rejets FOR DELETE TO authenticated USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
      END $$`,
    },
    {
      name: "ipm_parametres",
      query: `CREATE TABLE IF NOT EXISTS ipm_parametres (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        cle text NOT NULL,
        valeur text NOT NULL,
        description text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(tenant_id, cle)
      )`,
    },
    {
      name: "ipm_parametres_rls",
      query: `ALTER TABLE ipm_parametres ENABLE ROW LEVEL SECURITY`,
    },
    {
      name: "ipm_parametres_policies",
      query: `DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_parametres' AND policyname='select_own_ipm_parametres') THEN
          CREATE POLICY "select_own_ipm_parametres" ON ipm_parametres FOR SELECT TO authenticated USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_parametres' AND policyname='insert_own_ipm_parametres') THEN
          CREATE POLICY "insert_own_ipm_parametres" ON ipm_parametres FOR INSERT TO authenticated WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_parametres' AND policyname='update_own_ipm_parametres') THEN
          CREATE POLICY "update_own_ipm_parametres" ON ipm_parametres FOR UPDATE TO authenticated USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid())) WITH CHECK (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ipm_parametres' AND policyname='delete_own_ipm_parametres') THEN
          CREATE POLICY "delete_own_ipm_parametres" ON ipm_parametres FOR DELETE TO authenticated USING (tenant_id IN (SELECT tenant_id FROM profiles WHERE id = auth.uid()));
        END IF;
      END $$`,
    },
    {
      name: "indexes",
      query: `
        CREATE INDEX IF NOT EXISTS idx_ipm_organismes_tenant ON ipm_organismes(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_ipm_conventions_tenant ON ipm_conventions(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_ipm_conventions_organisme ON ipm_conventions(organisme_id);
        CREATE INDEX IF NOT EXISTS idx_ipm_beneficiaires_tenant ON ipm_beneficiaires(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_ipm_beneficiaires_customer ON ipm_beneficiaires(customer_id);
        CREATE INDEX IF NOT EXISTS idx_ipm_ventes_tenant ON ipm_ventes(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_ipm_ventes_statut ON ipm_ventes(tenant_id, statut);
        CREATE INDEX IF NOT EXISTS idx_ipm_bordereaux_tenant ON ipm_bordereaux(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_ipm_factures_tenant ON ipm_factures(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_ipm_reglements_tenant ON ipm_reglements(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_ipm_rejets_tenant ON ipm_rejets(tenant_id);
      `,
    },
  ];

  try {
    for (const m of migrations) {
      try {
        await sql.unsafe(m.query);
        results.push({ step: m.name, ok: true });
      } catch (e: any) {
        const msg = e?.message || String(e);
        if (msg.includes("already exists")) {
          results.push({ step: m.name, ok: true, error: "already exists (skipped)" });
        } else {
          results.push({ step: m.name, ok: false, error: msg });
        }
      }
    }
  } finally {
    await sql.end();
  }

  const allOk = results.every((r) => r.ok);

  return new Response(JSON.stringify({ success: allOk, results }), {
    status: allOk ? 200 : 500,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
