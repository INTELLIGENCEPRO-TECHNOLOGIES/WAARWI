/**
 * Moteur IPM centralise pour Waarwi Pharmacie.
 * Utilise partout : POS, Facturation, Devis, Bordereaux, Retours.
 */

export type IpmConventionConfig = {
  taux_defaut: number;
  plafond_facture?: number | null;
  plafond_jour?: number | null;
  plafond_mois?: number | null;
  plafond_annuel?: number | null;
  mode_calcul: 'total_facture' | 'ligne_par_ligne' | 'articles_eligibles';
  mode_arrondi: 'round' | 'floor' | 'ceil' | 'round5' | 'round10' | 'round25' | 'round50' | 'round100';
  application_plafond?: 'apres_calcul' | 'avant_calcul';
  ordonnance_obligatoire?: boolean;
  bon_prise_en_charge_obligatoire?: boolean;
  numero_bon_obligatoire?: boolean;
  numero_ordonnance_obligatoire?: boolean;
  medecin_prescripteur_obligatoire?: boolean;
  matricule_obligatoire?: boolean;
};

export type IpmArticleLine = {
  montant_ligne: number;
  ipm_eligible: boolean;
};

export type IpmDocuments = {
  numero_ordonnance: string;
  medecin: string;
  numero_bon: string;
};

export type IpmCalculResult = {
  part_ipm: number;
  part_client: number;
  montant_eligible: number;
  montant_non_eligible: number;
  montant_total: number;
  taux_applique: number;
  plafond_atteint: boolean;
};

export type IpmDocValidation = {
  valide: boolean;
  champs_manquants: string[];
};

/**
 * Applique l'arrondi selon le mode configure.
 */
export function appliquerArrondi(valeur: number, mode: string): number {
  switch (mode) {
    case 'floor': return Math.floor(valeur);
    case 'ceil': return Math.ceil(valeur);
    case 'round5': return Math.round(valeur / 5) * 5;
    case 'round10': return Math.round(valeur / 10) * 10;
    case 'round25': return Math.round(valeur / 25) * 25;
    case 'round50': return Math.round(valeur / 50) * 50;
    case 'round100': return Math.round(valeur / 100) * 100;
    case 'round':
    default: return Math.round(valeur);
  }
}

/**
 * Calcule la repartition IPM / client.
 * Moteur unique utilise dans tous les ecrans de l'application.
 */
export function calculerIpm(
  convention: IpmConventionConfig,
  lignes: IpmArticleLine[],
  remiseGlobale: number = 0
): IpmCalculResult {
  const taux = convention.taux_defaut || 0;
  const modeCalcul = convention.mode_calcul || 'total_facture';
  const modeArrondi = convention.mode_arrondi || 'round';
  const plafond = convention.plafond_facture ? Number(convention.plafond_facture) : null;

  const montantTotal = lignes.reduce((s, l) => s + l.montant_ligne, 0) - remiseGlobale;
  const montantEligible = lignes
    .filter(l => l.ipm_eligible)
    .reduce((s, l) => s + l.montant_ligne, 0);
  const montantNonEligible = lignes
    .filter(l => !l.ipm_eligible)
    .reduce((s, l) => s + l.montant_ligne, 0);

  let partIpm = 0;

  if (modeCalcul === 'ligne_par_ligne') {
    for (const ligne of lignes) {
      if (!ligne.ipm_eligible) continue;
      const partLigne = ligne.montant_ligne * (taux / 100);
      partIpm += appliquerArrondi(partLigne, modeArrondi);
    }
  } else if (modeCalcul === 'articles_eligibles') {
    const baseEligible = montantEligible;
    partIpm = appliquerArrondi(baseEligible * (taux / 100), modeArrondi);
  } else {
    // total_facture : on applique le taux sur le total (incluant les non eligibles)
    partIpm = appliquerArrondi(montantTotal * (taux / 100), modeArrondi);
  }

  let plafondAtteint = false;
  if (plafond && partIpm > plafond) {
    partIpm = plafond;
    plafondAtteint = true;
  }

  partIpm = Math.max(0, partIpm);
  const partClient = Math.max(0, montantTotal - partIpm);

  return {
    part_ipm: partIpm,
    part_client: partClient,
    montant_eligible: montantEligible,
    montant_non_eligible: montantNonEligible,
    montant_total: montantTotal,
    taux_applique: taux,
    plafond_atteint: plafondAtteint,
  };
}

/**
 * Valide que tous les documents obligatoires sont presents.
 */
export function validerDocumentsIpm(
  convention: IpmConventionConfig,
  documents: IpmDocuments,
  matricule?: string
): IpmDocValidation {
  const manquants: string[] = [];

  if (convention.ordonnance_obligatoire || convention.numero_ordonnance_obligatoire) {
    if (!documents.numero_ordonnance.trim()) {
      manquants.push('Numéro d\'ordonnance');
    }
  }
  if (convention.medecin_prescripteur_obligatoire) {
    if (!documents.medecin.trim()) {
      manquants.push('Médecin prescripteur');
    }
  }
  if (convention.bon_prise_en_charge_obligatoire || convention.numero_bon_obligatoire) {
    if (!documents.numero_bon.trim()) {
      manquants.push('Numéro de bon de prise en charge');
    }
  }
  if (convention.matricule_obligatoire && !matricule?.trim()) {
    manquants.push('Matricule du bénéficiaire');
  }

  return { valide: manquants.length === 0, champs_manquants: manquants };
}

/**
 * Construit un IpmConventionConfig a partir des donnees brutes Supabase.
 */
export function parseConvention(raw: any): IpmConventionConfig | null {
  if (!raw) return null;
  return {
    taux_defaut: Number(raw.taux_defaut || 0),
    plafond_facture: raw.plafond_facture ? Number(raw.plafond_facture) : null,
    plafond_jour: raw.plafond_jour ? Number(raw.plafond_jour) : null,
    plafond_mois: raw.plafond_mois ? Number(raw.plafond_mois) : null,
    plafond_annuel: raw.plafond_annuel ? Number(raw.plafond_annuel) : null,
    mode_calcul: raw.mode_calcul || 'total_facture',
    mode_arrondi: raw.mode_arrondi || 'round',
    application_plafond: raw.application_plafond || 'apres_calcul',
    ordonnance_obligatoire: !!raw.ordonnance_obligatoire,
    bon_prise_en_charge_obligatoire: !!raw.bon_prise_en_charge_obligatoire,
    numero_bon_obligatoire: !!raw.numero_bon_obligatoire,
    numero_ordonnance_obligatoire: !!raw.numero_ordonnance_obligatoire,
    medecin_prescripteur_obligatoire: !!raw.medecin_prescripteur_obligatoire,
    matricule_obligatoire: raw.matricule_obligatoire !== false,
  };
}

/**
 * Statuts IPM cote client (pour l'affichage de la facture).
 */
export type IpmClientStatus =
  | 'reglee_client'         // Client a paye sa part, IPM a recouvrer
  | 'reglee_client_ipm_bordereautee' // Client paye, bordereau IPM genere
  | 'reglee_client_ipm_facturee'    // Client paye, facture IPM envoyee
  | 'reglee_client_ipm_reglee'      // Tout regle
  | 'reglee_client_ipm_rejetee';    // Client paye, IPM a rejete

export function getIpmClientStatusLabel(status: IpmClientStatus): string {
  switch (status) {
    case 'reglee_client': return 'Réglée - IPM à recouvrer';
    case 'reglee_client_ipm_bordereautee': return 'Réglée - Bordereau IPM généré';
    case 'reglee_client_ipm_facturee': return 'Réglée - Facture IPM envoyée';
    case 'reglee_client_ipm_reglee': return 'Réglée - IPM réglée';
    case 'reglee_client_ipm_rejetee': return 'Réglée - IPM rejetée';
    default: return 'En cours';
  }
}

/**
 * Determine le vrai statut de la facture pour un client IPM.
 * Si le client a paye sa part, la facture est consideree comme "payee" cote client.
 */
export function determinerStatutFactureIpm(
  totalFacture: number,
  partClient: number,
  montantPayeParClient: number,
  partIpm: number
): { statut_client: string; label: string } {
  if (montantPayeParClient >= partClient && partIpm > 0) {
    return { statut_client: 'paid', label: 'Reglee (IPM a recouvrer)' };
  }
  if (montantPayeParClient > 0 && montantPayeParClient < partClient) {
    return { statut_client: 'partial', label: 'Partiellement payee' };
  }
  if (montantPayeParClient >= totalFacture) {
    return { statut_client: 'paid', label: 'Payee' };
  }
  return { statut_client: 'credit', label: 'A crédit' };
}
