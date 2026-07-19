/*
# Legal documents fields on landing_config

1. New Columns on `landing_config`
- `legal_mentions` (text, NOT NULL, default '') — Markdown content for the "Mentions légales" page at /mentions-legales
- `privacy_policy` (text, NOT NULL, default '') — Markdown content for the "Politique de confidentialité" page at /confidentialite
- `terms_of_service` (text, NOT NULL, default '') — Markdown content for the "Conditions générales d'utilisation" page at /cgu

2. Seed
- Populates the three fields on the existing 'default' row with a professional French template (éditeur INTELLIGENCEPRO TECHNOLOGIES, hébergeur Supabase, juridiction Sénégalaise).
- Only seeds when the column is empty, so re-running the migration never overwrites admin edits.

3. Security
- No new tables, no RLS changes. `landing_config` already has a public SELECT policy (anon + authenticated) and a super-admin UPDATE policy.
*/

ALTER TABLE landing_config
  ADD COLUMN IF NOT EXISTS legal_mentions text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS privacy_policy text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS terms_of_service text NOT NULL DEFAULT '';

UPDATE landing_config SET legal_mentions = $lm$# Mentions légales

## Éditeur du site

**INTELLIGENCEPRO TECHNOLOGIES**
Société éditrice de la plateforme Waarwi.
Dakar, Sénégal.

## Responsable de la publication

Le responsable de la publication est la direction d'INTELLIGENCEPRO TECHNOLOGIES.

## Hébergeur

Le site et la plateforme sont hébergés par **Supabase Inc.** (supabase.com), fournisseur d'infrastructure cloud assurant le stockage et le traitement des données.

## Propriété intellectuelle

L'ensemble des éléments présents sur ce site (textes, logos, graphismes, design, structure du site) est protégé par le droit de la propriété intellectuelle. Toute reproduction, représentation ou diffusion, totale ou partielle, sans autorisation préalable écrite est interdite.

## Marque

« Waarwi » est une marque exploitée par INTELLIGENCEPRO TECHNOLOGIES.

## Loi applicable

Le présent site est soumis au droit sénégalais. En cas de litige, les tribunaux sénégalais sont seuls compétents.
$lm$
WHERE id = 'default' AND (legal_mentions IS NULL OR legal_mentions = '');

UPDATE landing_config SET privacy_policy = $pp$# Politique de confidentialité

## Responsable du traitement

Le responsable du traitement des données personnelles est **INTELLIGENCEPRO TECHNOLOGIES**, éditrice de la plateforme Waarwi.

## Données collectées

Dans le cadre de l'utilisation de Waarwi, les données suivantes peuvent être collectées :

- **Données de compte** : nom, prénom, adresse e-mail, numéro de téléphone, nom de l'entreprise
- **Données d'utilisation** : ventes, stock, clients, fournisseurs, documents comptables saisis dans l'application
- **Données de connexion** : adresse IP, journaux d'activité, date et heure de connexion

## Finalités du traitement

- Gestion du compte utilisateur et de l'abonnement
- Fourniture des services de gestion commerciale (caisse, stock, facturation, comptabilité)
- Suivi et accompagnement client
- Respect des obligations légales et comptables

## Base légale

Le traitement est fondé sur l'exécution du contrat, le consentement de l'utilisateur et le respect des obligations légales.

## Durée de conservation

Les données sont conservées pendant toute la durée d'utilisation du service, puis archivées ou supprimées conformément aux obligations légales applicables.

## Destinataires

Les données sont accessibles à l'équipe d'INTELLIGENCEPRO TECHNOLOGIES et à l'hébergeur technique (Supabase Inc.). Elles ne sont jamais vendues ni cédées à des tiers à des fins commerciales.

## Hébergement

Les données sont hébergées par Supabase Inc., infrastructure cloud sécurisée.

## Vos droits

Conformément à la loi sénégalaise n°2008-12 sur la protection des données à caractère personnel et au Règlement Général sur la Protection des Données (RGPD), vous disposez des droits suivants :

- Droit d'accès à vos données
- Droit de rectification
- Droit à l'effacement
- Droit à la limitation du traitement
- Droit à la portabilité
- Droit d'opposition

Pour exercer ces droits, contactez-nous à l'adresse indiquée ci-dessous.

## Sécurité

Des mesures techniques et organisationnelles appropriées sont mises en place pour protéger vos données contre tout accès non autorisé, altération ou divulgation.

## Contact

Pour toute question relative à la protection de vos données : [contact@waarwi.com](mailto:contact@waarwi.com)
$pp$
WHERE id = 'default' AND (privacy_policy IS NULL OR privacy_policy = '');

UPDATE landing_config SET terms_of_service = $cgu$# Conditions générales d'utilisation

## 1. Objet

Les présentes conditions générales d'utilisation (CGU) régissent l'accès et l'utilisation de la plateforme Waarwi, éditée par **INTELLIGENCEPRO TECHNOLOGIES**.

En utilisant Waarwi, vous acceptez intégralement les présentes CGU.

## 2. Inscription et compte

- La création d'un compte nécessite des informations exactes et à jour.
- Vous êtes responsable de la confidentialité de vos identifiants.
- Un essai gratuit de 14 jours peut être proposé sans carte bancaire.
- À l'issue de l'essai, un abonnement payant est nécessaire pour continuer à utiliser le service.

## 3. Utilisation du service

Waarwi est une plateforme de gestion commerciale (caisse, stock, facturation, clients, comptabilité, boutique en ligne).

Vous vous engagez à :

- Utiliser le service conformément à sa destination
- Ne pas porter atteinte au bon fonctionnement de la plateforme
- Saisir des informations licites et conformes à la réalité

## 4. Facturation et abonnement

- Les tarifs sont indiqués sur la page Tarifs du site.
- L'abonnement est sans engagement et résiliable à tout moment.
- Le paiement s'effectue selon les modalités indiquées lors de la souscription.

## 5. Responsabilité

INTELLIGENCEPRO TECHNOLOGIES met tout en œuvre pour assurer la disponibilité et la sécurité du service. Toutefois, la société ne peut être tenue responsable :

- Des interruptions de service liées à des évènements techniques indépendants de sa volonté
- Des pertes de données résultant d'une négligence de l'utilisateur
- Des dommages indirects résultant de l'utilisation du service

## 6. Propriété intellectuelle

La plateforme Waarwi, son code, son design et ses contenus sont la propriété d'INTELLIGENCEPRO TECHNOLOGIES. Les données saisies par l'utilisateur restent sa propriété.

## 7. Données personnelles

Le traitement des données personnelles est décrit dans la [Politique de confidentialité](/confidentialite).

## 8. Résiliation

Vous pouvez résilier votre abonnement à tout moment. La résiliation prend effet à la fin de la période en cours.

## 9. Modification des CGU

INTELLIGENCEPRO TECHNOLOGIES se réserve le droit de modifier les présentes CGU. Les utilisateurs sont informés des modifications significatives.

## 10. Loi applicable et juridiction

Les présentes CGU sont soumises au droit sénégalais. En cas de litige, les tribunaux sénégalais sont seuls compétents.
$cgu$
WHERE id = 'default' AND (terms_of_service IS NULL OR terms_of_service = '');
