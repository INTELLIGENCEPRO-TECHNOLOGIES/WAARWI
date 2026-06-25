
-- Create IPM organismes table
CREATE TABLE IF NOT EXISTS public.ipm_organismes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
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
);

ALTER TABLE public.ipm_organismes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_ipm_organismes" ON public.ipm_organismes FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "insert_own_ipm_organismes" ON public.ipm_organismes FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "update_own_ipm_organismes" ON public.ipm_organismes FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "delete_own_ipm_organismes" ON public.ipm_organismes FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

-- Create IPM conventions table
CREATE TABLE IF NOT EXISTS public.ipm_conventions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  organisme_id uuid NOT NULL REFERENCES public.ipm_organismes(id) ON DELETE CASCADE,
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
);

ALTER TABLE public.ipm_conventions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_ipm_conventions" ON public.ipm_conventions FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "insert_own_ipm_conventions" ON public.ipm_conventions FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "update_own_ipm_conventions" ON public.ipm_conventions FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "delete_own_ipm_conventions" ON public.ipm_conventions FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

-- Create IPM beneficiaires table
CREATE TABLE IF NOT EXISTS public.ipm_beneficiaires (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  organisme_id uuid NOT NULL REFERENCES public.ipm_organismes(id),
  convention_id uuid REFERENCES public.ipm_conventions(id) ON DELETE SET NULL,
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
);

ALTER TABLE public.ipm_beneficiaires ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_ipm_beneficiaires" ON public.ipm_beneficiaires FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "insert_own_ipm_beneficiaires" ON public.ipm_beneficiaires FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "update_own_ipm_beneficiaires" ON public.ipm_beneficiaires FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "delete_own_ipm_beneficiaires" ON public.ipm_beneficiaires FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

-- Create IPM ventes table
CREATE TABLE IF NOT EXISTS public.ipm_ventes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  organisme_id uuid NOT NULL REFERENCES public.ipm_organismes(id),
  beneficiaire_id uuid REFERENCES public.ipm_beneficiaires(id),
  convention_id uuid REFERENCES public.ipm_conventions(id),
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
);

ALTER TABLE public.ipm_ventes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_ipm_ventes" ON public.ipm_ventes FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "insert_own_ipm_ventes" ON public.ipm_ventes FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "update_own_ipm_ventes" ON public.ipm_ventes FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "delete_own_ipm_ventes" ON public.ipm_ventes FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

-- Create IPM bordereaux table
CREATE TABLE IF NOT EXISTS public.ipm_bordereaux (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  organisme_id uuid NOT NULL REFERENCES public.ipm_organismes(id),
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
);

ALTER TABLE public.ipm_bordereaux ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_ipm_bordereaux" ON public.ipm_bordereaux FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "insert_own_ipm_bordereaux" ON public.ipm_bordereaux FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "update_own_ipm_bordereaux" ON public.ipm_bordereaux FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "delete_own_ipm_bordereaux" ON public.ipm_bordereaux FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

-- Create IPM factures table
CREATE TABLE IF NOT EXISTS public.ipm_factures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  organisme_id uuid NOT NULL REFERENCES public.ipm_organismes(id),
  bordereau_id uuid REFERENCES public.ipm_bordereaux(id),
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
);

ALTER TABLE public.ipm_factures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_ipm_factures" ON public.ipm_factures FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "insert_own_ipm_factures" ON public.ipm_factures FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "update_own_ipm_factures" ON public.ipm_factures FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "delete_own_ipm_factures" ON public.ipm_factures FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

-- Create IPM reglements table
CREATE TABLE IF NOT EXISTS public.ipm_reglements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  organisme_id uuid NOT NULL REFERENCES public.ipm_organismes(id),
  facture_id uuid REFERENCES public.ipm_factures(id),
  date_reglement date NOT NULL DEFAULT CURRENT_DATE,
  montant_recu numeric(12,2) NOT NULL,
  montant_attendu numeric(12,2),
  ecart numeric(12,2) DEFAULT 0,
  mode_reglement text NOT NULL DEFAULT 'virement',
  reference text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ipm_reglements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_ipm_reglements" ON public.ipm_reglements FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "insert_own_ipm_reglements" ON public.ipm_reglements FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "update_own_ipm_reglements" ON public.ipm_reglements FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "delete_own_ipm_reglements" ON public.ipm_reglements FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

-- Create IPM rejets table
CREATE TABLE IF NOT EXISTS public.ipm_rejets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vente_ipm_id uuid REFERENCES public.ipm_ventes(id),
  facture_id uuid REFERENCES public.ipm_factures(id),
  organisme_id uuid NOT NULL REFERENCES public.ipm_organismes(id),
  date_rejet date NOT NULL DEFAULT CURRENT_DATE,
  montant_rejete numeric(12,2) NOT NULL,
  motif text NOT NULL,
  statut text NOT NULL DEFAULT 'nouveau',
  action_corrective text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ipm_rejets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_ipm_rejets" ON public.ipm_rejets FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "insert_own_ipm_rejets" ON public.ipm_rejets FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "update_own_ipm_rejets" ON public.ipm_rejets FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "delete_own_ipm_rejets" ON public.ipm_rejets FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

-- Create IPM parametres table
CREATE TABLE IF NOT EXISTS public.ipm_parametres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  cle text NOT NULL,
  valeur text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, cle)
);

ALTER TABLE public.ipm_parametres ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_ipm_parametres" ON public.ipm_parametres FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "insert_own_ipm_parametres" ON public.ipm_parametres FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "update_own_ipm_parametres" ON public.ipm_parametres FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));
CREATE POLICY "delete_own_ipm_parametres" ON public.ipm_parametres FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ipm_organismes_tenant ON public.ipm_organismes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ipm_conventions_tenant ON public.ipm_conventions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ipm_conventions_organisme ON public.ipm_conventions(organisme_id);
CREATE INDEX IF NOT EXISTS idx_ipm_beneficiaires_tenant ON public.ipm_beneficiaires(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ipm_beneficiaires_customer ON public.ipm_beneficiaires(customer_id);
CREATE INDEX IF NOT EXISTS idx_ipm_ventes_tenant ON public.ipm_ventes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ipm_ventes_statut ON public.ipm_ventes(tenant_id, statut);
CREATE INDEX IF NOT EXISTS idx_ipm_bordereaux_tenant ON public.ipm_bordereaux(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ipm_factures_tenant ON public.ipm_factures(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ipm_reglements_tenant ON public.ipm_reglements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ipm_rejets_tenant ON public.ipm_rejets(tenant_id);
