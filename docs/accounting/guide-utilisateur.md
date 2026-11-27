# Prendre en main le bureau comptable
@ Démarrage │ Accueil comptable

Ce guide s’adresse aux personnes qui saisissent, contrôlent et clôturent les comptes dans Waarwi. Les parcours sont décrits depuis l’espace **Comptabilité**. Sur téléphone, ouvrez **Comptabilité** dans la barre supérieure pour retrouver les rubriques.

## Se repérer dans le bureau
| Menu | Travaux accessibles |
| Fichier | Revenir à l’accueil comptable et reprendre les accès directs. |
| Structure | Gérer le plan comptable, les codes journaux et les modèles de saisie. |
| Traitement | Saisir et consulter les écritures, lettrer, rapprocher la banque, réviser, suivre les immobilisations et l’analytique, clôturer. |
| État | Consulter et exporter les états comptables, fiscaux et financiers. |
| Fenêtre | Retrouver le bureau, organiser ou fermer les fenêtres. |
| Aide | Ouvrir **Guide de la comptabilité** dans le bureau. Utilisez **Ouvrir le guide** pour une consultation séparée ou **Télécharger le PDF**. |

## Travailler dans plusieurs fenêtres
1. Ouvrez une rubrique par le menu ou un accès direct. Un clic sur une pièce ou un compte ouvre son détail dans une fenêtre dédiée.
2. Sur ordinateur, utilisez **Agrandir** pour bénéficier de toute la hauteur, **Réduire** pour garder une fenêtre ouverte et **Fermer** pour la quitter. La barre basse permet de reprendre une fenêtre réduite. Le menu **Fenêtre** propose **Cascade** et **Mosaïque** pour comparer des documents.
3. Sur téléphone, utilisez les fenêtres une à une. Les actions se replient selon la largeur. Les listes paginées conservent leurs commandes de navigation au bas des fenêtres.

> **Vérifier le contexte** | Avant une action, contrôlez l’entreprise, la période, le journal et le compte. Le droit de consultation permet d’ouvrir les états. Les actions de gestion, comme la validation des écritures ou la clôture, dépendent du profil. Un bouton grisé peut également signaler une condition métier manquante.

# Préparer les comptes et les journaux
@ Structure │ Plan comptable et Codes journaux

## Créer ou modifier un compte
1. Ouvrez **Structure › Plan comptable**. Recherchez d’abord le numéro ou l’intitulé pour éviter un doublon.
2. Cliquez sur **Nouveau compte**, saisissez le code et le libellé selon votre plan et vérifiez son classement. Pour changer un compte existant, utilisez son action **Modifier**.
3. Ouvrez un numéro de compte pour interroger ses mouvements. Si le compte est déjà utilisé, vérifiez les écritures et les affectations avant toute désactivation.

## Importer le plan d’une entreprise
1. Ouvrez **Importer un plan comptable**, puis téléchargez le modèle Excel proposé.
2. Complétez votre fichier et chargez-le au format Excel ou CSV. Conservez les numéros de comptes en texte pour préserver leurs caractères.
3. Contrôlez l’aperçu des créations, renommages, lignes ignorées et erreurs. Corrigez le fichier si nécessaire, puis utilisez **Valider l’import**.
4. Exportez le plan en Excel ou CSV pour en conserver une copie de travail.

## Créer un journal de saisie
1. Ouvrez **Structure › Codes journaux › Nouveau journal**.
2. Renseignez un code de trois caractères au maximum et un intitulé explicite. Laissez **Actif** sélectionné si le journal doit être utilisable immédiatement.
3. Enregistrez et vérifiez que le journal est proposé dans **Saisie des écritures**. Les journaux système sont identifiés dans la liste. Le code d’un journal existant est fixe.

> **Affectations à vérifier au démarrage** | Dans les paramètres de l’entreprise, contrôlez les comptes utilisés pour les ventes, les achats, la caisse, les banques, les tiers et la TVA. Un compte inactif ou une affectation manquante peut empêcher la comptabilisation d’une pièce.

# Saisir une écriture manuelle
@ Traitement › Écritures › Saisie des écritures

## Saisir et valider la pièce
1. Ouvrez **Saisie des écritures**, ou **Nouvelle écriture** depuis **Journaux comptables**. Vérifiez que la modification est disponible si la saisie est déjà ouverte ailleurs.
2. Choisissez un journal actif et la date comptable. Renseignez le libellé d’en-tête et la référence du justificatif si vous la connaissez.
3. Pour chaque ligne, sélectionnez un compte actif. Complétez le libellé et saisissez le montant d’un seul côté, au **Débit** ou au **Crédit**.
4. Ajoutez une **Ligne** pour chaque poste. Contrôlez les totaux en bas de la fenêtre et l’indication **Équilibrée**.
5. Cliquez sur **Enregistrer**. Consultez ensuite le journal et la pièce générée. Si la période est fermée, vérifiez la date et les autorisations avant toute correction.

## Exemple fictif │ Facture d’électricité de 38 500 FCFA
| Compte | Libellé | Débit | Crédit |
| Compte de charge | Électricité novembre | 38 500 | — |
| Compte fournisseur | Électricité novembre | — | 38 500 |
| Total de la pièce |  | 38 500 | 38 500 |

Les comptes de l’exemple sont à choisir dans le plan de votre entreprise. Une facture issue directement d’une commande fournisseur se traite par le parcours **Factures fournisseurs**.

## Raccourcis sur ordinateur
| Raccourci | Action dans la saisie |
| Entrée | Passe au champ suivant, puis à la ligne suivante. |
| F2 | Ajoute une ligne. |
| F4 | Calcule la contrepartie sur la ligne active, après choix du compte. |
| Ctrl + Entrée | Enregistre une pièce prête à valider. |

# Consulter les journaux et corriger une pièce
@ Traitement › Écritures › Journaux comptables

## Retrouver et ouvrir une pièce
1. Choisissez le journal et renseignez les dates **Du** et **Au**. L’option **Tous les journaux** réunit également les journaux système.
2. Consultez le statut, les totaux et la référence. Cliquez sur le numéro de pièce ou choisissez **Consulter la pièce** dans son menu d’actions. L’origine, les lignes et le total s’ouvrent dans une fenêtre dédiée.
3. Pour retrouver une pièce sans connaître son journal, ouvrez **Traitement › Consultation › Recherche des écritures**. Combinez la période, le journal, le statut et les critères de recherche. **Réinitialiser** retire les filtres. **Exporter la page** conserve les lignes visibles de la recherche.

## Corriger une écriture manuelle déjà validée
1. Ouvrez la pièce validée et choisissez **Extourner l’écriture**.
2. Choisissez une date de contrepassation autorisée. Elle doit être au plus tôt à la date de l’original et au plus tard à la date du jour. Renseignez le motif.
3. Cliquez sur **Confirmer l’extourne**. Vérifiez le numéro de la pièce inverse, puis enregistrez l’écriture correcte si nécessaire. Les deux pièces restent reliées dans le journal.

## Corriger une facture ou une vente
1. Repérez la référence de la pièce commerciale. Ouvrez la fiche source depuis **Journal des ventes** ou **Facturation**.
2. Si la pièce est modifiable et votre profil l’autorise, cliquez sur **Modifier**. Le verrou indique si l’accès est libre ou déjà utilisé. Vérifiez le corps de facture, les totaux et les moyens de paiement avant d’enregistrer.
3. Si la pièce a déjà été validée ou comptabilisée, vérifiez l’action disponible sur sa fiche. Utilisez le retour, l’avoir ou l’autre mécanisme de correction prévu par le document et la période.

> **Exports** | Dans les journaux, choisissez **Exporter**, renseignez la période, le journal et le format proposé, puis **Préparer › Télécharger**. Contrôlez le résultat avant de l’importer dans un autre logiciel.

# Créer et maintenir les modèles de saisie
@ Structure › Modèles de saisie

Un modèle mémorise la trame d’une écriture récurrente. Il est utile pour les loyers, frais de banque, abonnements et autres opérations à structure stable. Enregistrer le modèle permet de le réutiliser. L’écriture comptable sera enregistrée séparément.

## Créer un modèle depuis la structure
1. Cliquez sur **Nouveau modèle** et renseignez **Intitulé du modèle** et **Libellé de l’écriture**.
2. Affectez le **Journal** si ce modèle doit être disponible uniquement dans ce journal. Choisissez **Tous les journaux** pour l’appeler dans n’importe quel journal actif.
3. Pour chaque ligne, choisissez les règles de **Compte**, **Libellé** et **Montant**. Indiquez le sens attendu et utilisez **Enregistrer le modèle**.

| Règle | Comportement à l’appel |
| Fixe | Reprend la valeur enregistrée dans le modèle. |
| À saisir | Demande de renseigner la valeur au moment d’utiliser le modèle. |
| Répéter | Reprend la valeur de la ligne précédente pour ce champ. La première ligne doit fournir une valeur de départ. |
| Équilibrer | Calcule la contrepartie sur la seule ligne déclarée à cet effet. En sens automatique, le modèle choisit le côté nécessaire. |

## Créer un modèle à partir d’une pièce
1. Ouvrez **Traitement › Écritures › Journaux comptables** et identifiez l’écriture de référence.
2. Ouvrez la pièce et cochez au moins deux lignes à reprendre. Sur ordinateur, cliquez avec le bouton droit sur une ligne cochée et choisissez **Créer un modèle de saisie**. La même action est disponible dans la pièce, y compris sur téléphone.
3. Le menu d’actions de la ligne du journal propose aussi **Créer un modèle de saisie**. Il ouvre la pièce avec toutes les lignes cochées. Ajustez la sélection au besoin.
4. Relisez la proposition, corrigez les montants et libellés repris, puis remplacez les valeurs variables par **À saisir**. Élargissez la portée du journal si nécessaire et enregistrez.
5. Retrouvez le modèle dans **Structure › Modèles de saisie** pour le modifier ou l’archiver. Dans une nouvelle écriture, **Créer un modèle depuis la saisie** permet aussi de mémoriser une trame.

# Appeler un modèle et traiter une échéance
@ Traitement › Écritures › Saisie des écritures

## Utiliser le modèle dans le bon journal
1. Dans **Saisie des écritures**, choisissez le journal avant d’appeler le modèle. La liste propose les modèles du journal et ceux disponibles dans tous les journaux.
2. Utilisez **Appeler un modèle**, également proposé dans les journaux. Sélectionnez le modèle, cliquez sur **Préparer le modèle** et complétez les champs **À saisir**.
3. Vérifiez le résultat du calcul d’équilibrage et l’ordre des lignes, puis cliquez sur **Reprendre en saisie**. Si une saisie est déjà ouverte, lisez la demande de remplacement avant de la confirmer.
4. Renseignez la date et la référence de la pièce du jour. Relisez les comptes, libellés et totaux, puis cliquez sur **Enregistrer**.

## Exemple fictif │ Loyer variable, sans recopier le montant
| Ligne | Compte | Libellé | Montant |
| 1 | Fixe │ compte de loyers | À saisir | À saisir au débit |
| 2 | Fixe │ compte fournisseur ou banque adapté | Répéter | Équilibrer │ automatique ou crédit |

À l’appel, saisissez par exemple « Loyer novembre » et **250 000 FCFA** sur la première ligne. Vérifiez que la seconde reprend le libellé et crédite 250 000 FCFA. Sélectionnez le compte de contrepartie approprié selon qu’il s’agit d’une facture à payer ou d’une dépense réglée.

## Préparer une récurrence mensuelle
1. Dans **Structure › Modèles de saisie**, choisissez **Planifier chaque mois** sur un modèle affecté à un journal.
2. Renseignez la première échéance et cliquez sur **Planifier**. À la date prévue, appelez le modèle depuis son journal puis choisissez **Préparer l’échéance**.
3. Vérifiez la date, les lignes et le justificatif du mois avant d’enregistrer. L’échéance guide la préparation de la pièce. Elle ne vaut pas validation comptable.

> **Modèle introuvable** | Vérifiez le journal sélectionné et l’état du modèle. Contrôlez aussi que les comptes fixes du modèle sont encore actifs.

# Rapprocher une banque │ préparer le relevé
@ Traitement › Rapprochement bancaire │ Relevés

Le rapprochement compare les opérations réellement passées sur le compte bancaire aux écritures validées dans Waarwi. Rassemblez le relevé officiel, son intervalle, ses soldes d’ouverture et de clôture et les références des opérations.

## Créer ou reprendre le relevé
1. Dans **Compte bancaire ou de monnaie électronique**, sélectionnez le compte correspondant au relevé. Si un relevé est en cours, choisissez **Reprendre le relevé** pour continuer. Sinon, choisissez **Nouveau relevé**.
2. Renseignez la **Référence du relevé**, les dates, le solde initial et le **Solde final indiqué**. Le premier relevé doit démarrer sur une situation d’ouverture déjà rapprochée. Après un relevé validé, le suivant reprend le solde final et commence le lendemain.
3. Cliquez sur **Importer CSV / Excel** ou **Ajouter une opération**. L’import remplit les opérations. Saisissez les soldes indiqués sur le relevé dans les champs séparés.
4. Vérifiez les dates, les libellés et le signe de chaque montant. Le solde initial augmenté des mouvements doit donner le solde final indiqué. Si le contrôle concorde, cliquez sur **Enregistrer le relevé**.

| Convention du fichier | Utiliser quand… |
| Montant signé | Le fichier contient une colonne Montant. Entrée positive et sortie négative du point de vue de l’entreprise. |
| Relevé banque | Le relevé à deux colonnes considère un débit bancaire comme une sortie de votre compte. |
| Comptabilité | La source à deux colonnes considère un débit du compte de banque comme une entrée. |

Pour l’import, utilisez les en-têtes **Date**, **Libellé**, **Montant** ou les deux colonnes **Débit** et **Crédit**, et éventuellement **Référence**. Le **Modèle CSV** reprend la convention choisie. La limite est de 500 opérations par import.

> **Contrôle chiffré** | Solde initial 1 000 000 FCFA, dépôt +250 000 FCFA, règlement −100 000 FCFA et frais −5 000 FCFA. Le solde final doit être 1 145 000 FCFA. Une différence à ce stade se corrige dans le relevé saisi.

# Rapprocher une banque │ pointer les opérations
@ Traitement › Rapprochement bancaire │ Pointage

## Pointer manuellement
1. Passez à **Pointage › Manuel**. Dans la liste du relevé, choisissez une opération **À pointer**.
2. Dans **Écritures non pointées**, sélectionnez la ligne du même compte portant le même montant dans le même sens. Comparez la référence, le libellé et la date. Sur téléphone, utilisez **Relevé** et **Écritures**.
3. Cliquez sur **Pointer les opérations**. Vérifiez le passage à l’état **Pointée**. Sur un relevé en cours, **Dépointer** permet de reprendre une association incorrecte.

## Pointer avec les suggestions
1. Choisissez **Suggestions**, puis **Analyser les correspondances**.
2. Vérifiez chaque paire proposée. Cochez celles dont les références et les montants concordent, puis choisissez **Pointer la sélection › Confirmer le pointage**.
3. Examinez manuellement les opérations restantes. Une suggestion absente ou ambiguë nécessite de relire les pièces et les critères.

## Traiter une opération réellement absente de la comptabilité
1. Recherchez d’abord le montant et la référence dans les journaux. Vérifiez aussi la période du mouvement et le compte de banque utilisé.
2. Sur l’opération bancaire isolée, choisissez **Comptabiliser une opération absente**. Ce parcours couvre une charge ou un produit confirmé, par exemple des frais bancaires, avec un compte de contrepartie approprié.
3. Renseignez **Compte de contrepartie** et **Motif**. Choisissez un compte de classe 6 pour une charge ou de classe 7 pour un produit, puis **Comptabiliser et pointer**. Vérifiez la pièce générée.

> **Éviter un doublon** | Si la banque regroupe plusieurs écritures ou si la contrepartie attendue est un compte de tiers, recherchez la pièce d’origine et suivez la procédure comptable adaptée. Le pointage standard associe une ligne du relevé et une ligne comptable de même montant et de même sens.

# Rapprocher une banque │ contrôler et valider
@ Traitement › Rapprochement bancaire │ Contrôle

1. Choisissez **Contrôler le rapprochement** pour vérifier les opérations et les soldes.
2. Assurez-vous que les trois contrôles ci-dessous aboutissent. Revenez dans **Pointage** pour corriger une association ou recherchez une pièce antérieure si l’ouverture a changé.
3. Cliquez sur **Valider le rapprochement › Confirmer la validation**. Rouvrez le relevé enregistré pour vérifier son état et conservez le justificatif bancaire avec le dossier de la période.

| Contrôle | Résultat attendu et action en cas d’écart |
| Opérations du relevé restant à pointer | Zéro. Vérifiez les pièces manquantes et celles affectées à un autre compte. |
| Écart de rapprochement | 0 FCFA. Vérifiez les montants, les signes et les pointages de la période. |
| Variation du solde d’ouverture | 0 FCFA. Recherchez les écritures rétroactives ou les erreurs de reprise du solde. |

Par exemple, un chèque émis pas encore débité reste en attente sur les prochains relevés. Le **Calcul du solde rapproché** présente le solde comptable, les mouvements non pointés, le solde ajusté et le solde du relevé. Si les trois contrôles sont satisfaits, les écritures comptables en attente ne bloquent pas la validation.

## Traiter un relevé saisi sur le mauvais compte
1. Pour un relevé **en cours**, ouvrez **Contrôle** et choisissez **Annuler le relevé**. Saisissez un motif précis et confirmez.
2. Rouvrez le compte approprié et créez le relevé avec les références et soldes vérifiés.
3. Si un relevé **validé** signale une évolution du solde comptable, examinez les pièces rétroactives et le dernier relevé avec le responsable comptable avant toute régularisation.

> **Différence avec le lettrage** | Le rapprochement relie un relevé bancaire externe aux mouvements de banque. Le lettrage regroupe des débits et crédits d’un même compte de tiers, par exemple une facture et son règlement.

# Interroger un compte et lettrer
@ Traitement › Consultation › Interrogation et lettrage

## Consulter les mouvements d’un compte
1. Sélectionnez le compte depuis le plan, le grand livre ou **Interrogation et lettrage**. Saisissez son numéro si vous le connaissez.
2. Indiquez **Du** et **Au**, puis choisissez **Interroger**. Vérifiez le solde initial, les débits et crédits de la période et le solde cumulé.
3. Ouvrez un numéro de pièce pour lire son origine. **Exporter cette page (CSV)** télécharge les mouvements de la page consultée.

## Lettrer manuellement ou à partir des propositions
1. Ouvrez **Lettrage et propositions**. Sélectionnez les lignes de la facture, des règlements et, s’il y a lieu, de l’avoir. Elles doivent appartenir au même compte.
2. Vérifiez l’écart. Par exemple, une facture de 59 000 FCFA rapprochée de règlements de 30 000 et 29 000 FCFA forme un groupe équilibré.
3. Cliquez sur **Lettrer** ou **Lettrer la sélection**. Vérifiez le code de lettrage affiché sur les lignes.
4. Pour un lot, choisissez **Rechercher les correspondances**, contrôlez les pièces proposées et validez les groupes retenus. Pour annuler un groupe lettré, utilisez **Délettrer** et renseignez le motif. Toute la sélection du groupe est libérée.

> **Traiter un petit écart** | La fonction peut créer une OD d’écart jusqu’à 1 000 FCFA. Utilisez-la pour une différence réellement justifiée. Sélectionnez vous-même le compte approprié, la date et le motif. Une créance à recouvrer ou un paiement partiel reste ouvert.

# Analyser les soldes et échéances des tiers
@ État › Balance des tiers et Balance âgée et échéances

## Vérifier les comptes de clients et fournisseurs
1. Ouvrez **Balance des tiers** et sélectionnez **Clients** ou **Fournisseurs**.
2. Comparez les totaux aux comptes collectifs du grand livre. Utilisez la recherche pour cibler un tiers, puis ouvrez le détail du compte.
3. En cas de différence, examinez les pièces rattachées au tiers, les avoirs, les règlements, les dates de saisie et le compte collectif. Vérifiez le périmètre avant de comparer deux états.

## Utiliser la balance âgée
1. Ouvrez **Balance âgée et échéances**. Choisissez le type de tiers et la date **Arrêté au**, puis **Afficher**.
2. L’onglet **Balance âgée** résume les montants par compte et tranche de retard. Cliquez sur un compte pour approfondir, ou ouvrez **Échéancier détaillé**.
3. Dans l’échéancier, filtrez les tranches et pièces. Si une échéance doit être corrigée et que vous disposez du droit, renseignez **Échéance réelle** et **Justificatif / motif**, puis enregistrez.
4. Utilisez **CSV page** pour conserver les éléments détaillés à traiter. Identifiez les montants non échus, les retards et les échéances manquantes avant de produire une liste de relance.

| Situation | Vérification à faire |
| Solde inattendu | Vérifier les dates, les avoirs imputés et les règlements affectés au bon tiers. |
| Facture partiellement réglée | Comparer le solde restant au montant des règlements. Laisser le résiduel ouvert. |
| Échéance inconnue | Retrouver la date contractuelle à partir de la facture et renseigner le motif. |

# Comptabiliser les documents de gestion
@ État › Balance générale │ Actions de comptabilisation

## Ventes, avoirs et règlements
1. Ouvrez la balance et repérez les actions de comptabilisation accessibles à votre profil. Pour un cas particulier, revenez à la pièce d’origine dans Facturation, Journal des ventes ou Achats.
2. Choisissez l’action correspondant aux ventes ou aux règlements clients et fournisseurs. Lisez le récapitulatif avant validation.
3. Consultez le **Compte rendu**. Réconciliez les pièces comptabilisées avec les écritures générées. Vérifiez les références en échec ou ignorées avant de relancer.

## Facture fournisseur à partir d’une réception
1. Ouvrez **Factures fournisseurs**, repérez la commande reçue et choisissez **Saisir la facture**.
2. Renseignez le numéro et la date de la facture du fournisseur. Contrôlez la réception, le fournisseur et les montants.
3. Si nécessaire, saisissez la **Ventilation de la TVA**. Vérifiez le HT, la TVA et le TTC, confirmez les montants, la déductibilité et le justificatif, puis cliquez sur **Comptabiliser la facture**.
4. Retrouvez la pièce en journal d’achats et le montant au compte fournisseur. Gardez le justificatif avec la réception.

## Revoir les mouvements de caisse
1. Dans la revue des **Mouvements de caisse**, choisissez les dates et le coffre, puis **Contrôler la période**.
2. Utilisez **Vérifier la pièce** pour une opération déjà reliée. Pour un mouvement à traiter, vérifiez l’origine et la contrepartie, puis choisissez **Comptabiliser** et **Confirmer l’écriture** lorsque l’action est disponible.
3. Pour les associations proposées, vérifiez le journal et choisissez **Rapprocher les écritures existantes**. Un mouvement sans lien peut déjà avoir une écriture.

# Consulter la balance et le grand livre
@ État › Balance générale et Grand livre

## Adopter les mêmes critères pour comparer deux états
1. Vérifiez les dates et, lorsque le filtre est proposé, les comptes ou le journal. Cliquez sur **Afficher** après avoir modifié les critères, puis **Actualiser** pour relire les données.
2. Dans **Balance générale**, comparez le solde d’ouverture, les mouvements de la période et le solde de clôture par compte. Le total de période permet de détecter un périmètre filtré ou incomplet.
3. Dans **Grand livre**, poursuivez jusqu’à la ligne d’écriture pour lire sa date, son libellé, son débit ou crédit et son solde cumulé. Ouvrez la pièce ou l’interrogation du compte quand nécessaire.
4. Utilisez les commandes de page au bas de la fenêtre. Un total du compte « toutes pages » concerne l’ensemble de la période sélectionnée.

## Exporter et comparer
1. Délimitez la période avant d’exporter. Le fichier Excel des états de période peut contenir jusqu’à 5 000 lignes. Réduisez le périmètre par date ou compte si le volume dépasse cette limite.
2. Conservez le filtre, les dates et la date d’extraction avec le fichier. Si l’écran signale un changement de données, actualisez avant une nouvelle extraction.
3. Rapprochez les totaux avec un état comportant la même entreprise, la même période et les mêmes comptes. Vérifiez ensuite les pièces à l’origine des écarts.

| Besoin | Écran à utiliser |
| Contrôler les soldes de tous les comptes | Balance générale |
| Reconstituer le détail d’un solde | Grand livre et Interrogation et lettrage |
| Retrouver une pièce par référence | Journaux comptables ou Recherche des écritures |
| Vérifier un collectif client ou fournisseur | Balance des tiers puis Grand livre |

# Vérifier la situation de TVA
@ État › Situation de TVA

1. Avant d’ouvrir l’état, vérifiez les comptes de TVA affectés dans les paramètres ainsi que le fonctionnement de la TVA sur les pièces de l’entreprise.
2. Sélectionnez la période, de 367 jours au maximum, puis cliquez sur **Actualiser**.
3. Comparez la TVA collectée, la TVA récupérable et le solde. Ouvrez les pièces et contrôlez les autres mouvements comptables des comptes affectés.
4. Lisez **Contrôles avant déclaration**. Passez en revue les ventes et avoirs avec TVA non comptabilisés, les commandes reçues non comptabilisées et les lignes relevées sur d’autres comptes 443 ou 445.
5. Résolvez les écarts sur les pièces ou comptes concernés puis relancez le calcul. Utilisez **Exporter la synthèse (CSV)** et, si nécessaire, **Exporter cette page (CSV)** pour les mouvements.

| Si l’état affiche… | Vérification |
| Un avoir avec TVA non comptabilisé | Vérifier le document, son statut et sa date. Comptabiliser par la procédure correspondante, puis actualiser. |
| Une commande reçue en attente | Vérifier la facture du fournisseur et la saisie de sa ventilation de TVA. |
| Des mouvements sur un autre compte 443 ou 445 | Ouvrir le grand livre, identifier le compte et valider son traitement avec le responsable comptable. |
| Un montant différent de votre état de ventes | Contrôler la période, les avoirs, les pièces non transférées et les opérations saisies directement en comptabilité. |

> **À conserver dans le dossier** | Archivez le fichier de synthèse, les mouvements examinés, les justifications et la référence du rapprochement effectué avant d’établir la déclaration.

# Gérer les immobilisations et amortissements
@ Traitement › Immobilisations et amortissements

## Créer une fiche depuis une acquisition comptabilisée
1. Ouvrez **Nouvelle fiche** et recherchez la ligne d’acquisition. Vérifiez la pièce, le compte et le montant avant de l’associer.
2. Saisissez le code du bien, sa désignation, sa localisation et sa date de mise en service. Renseignez la durée en mois, la valeur résiduelle et le justificatif.
3. Affectez les comptes d’amortissement et de dotation du plan. Choisissez **Enregistrer la fiche** puis comparez la valeur brute du registre avec le grand livre.

## Suivre et enregistrer les dotations
1. Choisissez la date d’arrêté et filtrez les biens **En service** ou **Sorties**.
2. Ouvrez le bien et vérifiez le plan des dotations, le cumul amorti et la valeur nette. Le **Couru non comptabilisé** aide à repérer les montants à traiter.
3. Si la prochaine dotation est due et les comptes corrects, choisissez **Comptabiliser la prochaine dotation**. Vérifiez la pièce générée et le registre.
4. Utilisez **Excel** pour exporter le registre et contrôlez les écarts avec le grand livre par compte.

## Comptabiliser une sortie
1. Ouvrez **Sortir le bien**, choisissez **Cession** ou **Mise au rebut**, puis la date et les références.
2. Contrôlez l’aperçu de la dotation complémentaire, du cumul et de la valeur nette à sortir. Pour une cession, liez les éléments justificatifs proposés par l’écran.
3. Choisissez le compte de valeur comptable et décrivez le motif. Cliquez sur **Comptabiliser la sortie** après contrôle et vérifiez la pièce.

# Ventiler les écritures et suivre les budgets
@ Traitement › Analytique et budgets

## Structurer les axes et sections
1. Créez un axe puis les sections que vous souhaitez comparer, par exemple un axe Magasins avec une section par point de vente.
2. Choisissez l’axe, le mois et la section dans les filtres. Cliquez sur **Actualiser** pour vérifier la situation.

## Ventiler les écritures
1. Ouvrez **Ventiler les écritures** et recherchez la pièce ou le compte à analyser.
2. Sélectionnez la ligne puis une section. Renseignez le motif et cliquez sur **Enregistrer**.
3. Contrôlez le résultat net, le nombre de lignes non ventilées, leur montant en valeur absolue et l’écart de réconciliation. Les totaux analytiques s’interprètent dans le périmètre du mois et de l’axe affichés.

## Enregistrer et comparer un budget
1. Dans **Budget**, choisissez la section et le compte, puis saisissez le montant prévu et sa justification.
2. Enregistrez. Ouvrez **Budgets / réalisations** pour comparer le réalisé, le budget et l’écart favorable.
3. Utilisez **Excel complet** pour détailler l’analyse et conserver la date d’arrêté et les critères utilisés.

| Cas fictif | Lecture |
| Budget de frais de 300 000 FCFA | Comparer le réalisé au budget pour la même section, le même compte et le même mois. |
| Réalisé de 270 000 FCFA | L’écart favorable est de 30 000 FCFA si toutes les écritures du périmètre sont ventilées. |

# Réviser les comptes et clôturer un mois
@ Traitement › Révision comptable et Clôtures › Clôtures mensuelles

## Constituer le dossier de révision mensuelle
1. Ouvrez **Révision comptable**, indiquez la période et cliquez sur **Contrôler**.
2. Ouvrez chaque cycle pertinent. Relisez les pièces, les comptes inactifs et les anomalies. Ouvrez le détail de la pièce quand une ligne nécessite une justification.
3. Documentez chaque contrôle comme **À faire**, **Contrôlé** ou **Non applicable**. Justifiez les contrôles écartés, indiquez les références des pièces, puis enregistrez le dossier.
4. Si les données changent après la dernière révision, reprenez le dossier sur les chiffres actualisés et exportez la version revue avec **Exporter le dossier**.

## Clôturer un mois civil terminé
1. Ouvrez **Clôtures mensuelles** et sélectionnez le mois terminé. Examinez le journal et la balance, les mouvements à rapprocher et les comptes de tiers.
2. Traitez les contrôles bloquants, validez les opérations en attente et expliquez les écarts restants. Recontrôlez la période après les corrections.
3. Lorsque la clôture est disponible, cliquez sur **Clôturer le mois** et confirmez les informations demandées.
4. Vérifiez l’état **Mois clôturé**. Conservez les états, les rapprochements et la révision avec les justificatifs.

> **Ordre de travail** | Transférer les pièces commerciales, rapprocher la banque, justifier le coffre, lettrer les tiers et contrôler la TVA précède la révision et la clôture du mois. Vérifiez le statut du mois avant de saisir une correction à une date passée.

# Clôturer l’exercice et contrôler les reports
@ Traitement › Clôtures › Exercices et reports à nouveau

1. Choisissez **Exercice civil**, le compte de bénéfice et le compte de perte. Vérifiez ces affectations selon le plan de l’entreprise.
2. Cliquez sur **Contrôler l’exercice**. Examinez **Contrôle des périodes** et **Contrôles bloquants**. Contrôlez les rapprochements, les écritures, les états et les travaux de révision de fin d’année.
3. Consultez **Balance annuelle** puis **Reports à nouveau**. Comparez les soldes de clôture avec les débits et crédits d’ouverture prévus sur les comptes à reporter. Exportez le CSV au besoin.
4. Saisissez la **Note de clôture obligatoire** et relisez les effets avant l’action de clôture définitive. Procédez avec le profil autorisé après validation du dossier de l’exercice.
5. Vérifiez ensuite l’état de l’exercice, la pièce de report et les soldes d’ouverture du nouvel exercice. Archivez les états de contrôle et la note.

| Point de contrôle | Vérification |
| Périodes de l’exercice | Aucun mois ni contrôle bloquant en suspens. |
| Comptes de résultat | Affectations du bénéfice et de la perte correctes avant calcul. |
| Reports à nouveau | Continuité entre la clôture N et l’ouverture de N+1 sur les comptes concernés. |
| États annuels | Balance, grand livre, états financiers et notes sauvegardés pour le dossier. |

# Produire les états financiers
@ État › États financiers

1. Choisissez **Exercice**, puis **Actualiser**. Vérifiez si l’exercice précédent existe et s’il est clôturé avant de lire les colonnes comparatives.
2. Ouvrez le bilan, le compte de résultat et les soldes intermédiaires de gestion. Analysez les **Contrôles à traiter** et les **Comptes à classer et données annexes**.
3. Vérifiez les montants auprès du détail par compte, puis corrigez les comptes atypiques ou l’affectation des rubriques dans le dossier de travail.
4. Pour le dossier détaillé, contrôlez l’actif brut, les amortissements, le net et le comparatif N−1. Examinez l’état préparatoire des flux et, pour le tableau par méthode indirecte, justifiez les rubriques ZA à ZH.
5. Complétez les **Notes annexes**. Utilisez **Préremplir les rubriques simples** lorsque proposé, vérifiez les montants et justifications, puis choisissez **Enregistrer le dossier**.
6. Employez **Imprimer / PDF** pour la consultation ou le dossier imprimable et **Excel détaillé** pour les tableaux détaillés. Avant diffusion, vérifiez la période, le classement des comptes, les comparatifs et les notes.

> **États de travail** | Les contrôles, ventilations et rubriques préremplies assistent la préparation du dossier. Appuyez la validation finale sur les pièces, la balance, le cadre applicable à votre entreprise et la revue du responsable comptable.

# Diagnostic des blocages et repères
@ Référence rapide │ Pour tous les parcours

| Symptôme | Vérifier dans cet ordre |
| Le bouton Enregistrer est grisé | Droit de gestion, fenêtre de modification, journal actif, compte actif, équilibre, date et champs obligatoires. |
| Une pièce commerciale manque dans le journal | Référence et dates, statut de la pièce, action Comptabiliser et compte rendu. Contrôler l’origine avant de ressaisir. |
| Un relevé ne s’enregistre pas | Compte bancaire, période sans chevauchement, convention du fichier, dates des opérations et solde initial + mouvements. |
| Une opération ne se pointe pas | Même compte, montant et sens identiques. Vérifier qu’elle n’est pas déjà pointée, puis comparer les références et la date. |
| Un modèle n’apparaît pas | Ouvrir le bon journal et vérifier la portée, l’état et les comptes fixes du modèle. |
| Un rapport paraît incomplet | Contrôler les filtres, le nombre de pages, les dates et le statut des écritures. Actualiser l’état après correction. |

## Éléments à relever avant de contacter le support
1. Notez le module, l’écran, l’action et le message exact. Relevez les références de la pièce, du journal et de la période.
2. Décrivez le résultat attendu et le résultat obtenu. Indiquez si le problème est présent sur téléphone, ordinateur ou les deux.
3. Dans une capture, masquez les données qui ne sont pas nécessaires à la résolution. Transmettez le message avec les références utiles.

# Glossaire comptable
@ Référence rapide │ Vocabulaire des écrans

| Terme | Définition |
| Pièce | Ensemble des lignes d’une écriture, identifié par un numéro et une origine. |
| OD | Opération diverse saisie dans le journal approprié. |
| Extourne | Écriture inverse liée à une écriture validée, qui en conserve la trace. |
| Lettrage | Association de débits et crédits équilibrés d’un même compte. |
| Pointage | Association d’une opération bancaire avec un mouvement comptable correspondant. |
| RAN | Report à nouveau des soldes à l’ouverture du nouvel exercice. |
| VNC | Valeur nette comptable d’une immobilisation après amortissements ou dépréciations applicables. |

## Autres repères utiles
| Terme | Définition |
| Compte collectif | Compte du plan qui regroupe les mouvements de plusieurs tiers. |
| Balance | État des soldes et mouvements des comptes sur un périmètre donné. |
| Grand livre | Détail des pièces et mouvements, organisé par compte. |
| Justificatif | Document qui explique et soutient une écriture ou une décision de traitement. |
| SIG | Soldes intermédiaires de gestion qui décomposent les étapes de formation du résultat. |
