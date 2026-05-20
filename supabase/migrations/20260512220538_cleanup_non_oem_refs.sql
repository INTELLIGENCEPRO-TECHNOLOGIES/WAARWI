/*
  # Nettoyage des références OEM non-constructeur

  1. Contexte
    Le champ `oem_ref` contient actuellement un mélange de :
      - Vraies références constructeur (Toyota, Nissan, BMW…)
      - Références équipementiers (MANN, BOSCH, BREMBO, TRW…) qui ne sont PAS des OEM
      - Codes internes / SKU générés pour des accessoires (KIT-…, AMPLI-…, RADAR-…)
      - Codes produits non-auto (réfrigérateur, etc.)

  2. Modifications
    - `articles` : vide `oem_ref` lorsque la marque est un équipementier reconnu
      ou lorsque la valeur est manifestement un SKU interne (préfixes KIT-, AMPLI-,
      RADAR-, HP-, SUB-, TWT-, CMD-VOL-, VOLAN-, PROJ-, ou contient « UNIV »).
    - `master_catalog_items` : applique le même nettoyage sur `manufacturer_ref`
      pour rester cohérent avec le catalogue maître.

  3. Sécurité / Données
    - Aucun DROP. Seulement des UPDATE qui mettent à '' les fausses références.
    - Les vraies références OEM constructeur (brand = constructeur véhicule) sont conservées.
*/

-- 1) Articles : vider les oem_ref qui sont en réalité des refs équipementiers
UPDATE public.articles
SET oem_ref = ''
WHERE oem_ref IS NOT NULL AND oem_ref <> ''
  AND UPPER(TRIM(brand)) IN (
    'BOSCH','MANN','MAHLE','BREMBO','TRW','FRAM','PURFLUX','CHAMPION','FERODO',
    'GATES','SKF','NGK','NTK','DENSO','VALEO','MOOG','KAYABA','MONROE','ATE',
    'AISIN','LUK','CONTITECH','LEMFORDER','FAG','DOLZ','EXIDE','VARTA','TOTAL',
    'CASTROL','SAMSUNG'
  );

-- 2) Articles : vider les oem_ref qui sont des SKU internes / codes accessoires
UPDATE public.articles
SET oem_ref = ''
WHERE oem_ref IS NOT NULL AND oem_ref <> ''
  AND (
    oem_ref ILIKE 'KIT-%' OR
    oem_ref ILIKE 'AMPLI-%' OR
    oem_ref ILIKE 'RADAR-%' OR
    oem_ref ILIKE 'HP-%' OR
    oem_ref ILIKE 'SUB-%' OR
    oem_ref ILIKE 'TWT-%' OR
    oem_ref ILIKE 'CMD-VOL-%' OR
    oem_ref ILIKE 'VOLAN-%' OR
    oem_ref ILIKE 'PROJ-%' OR
    oem_ref ILIKE '%UNIV%'
  );

-- 3) Master catalog : même logique sur manufacturer_ref
UPDATE public.master_catalog_items
SET manufacturer_ref = ''
WHERE manufacturer_ref IS NOT NULL AND manufacturer_ref <> ''
  AND UPPER(TRIM(brand)) IN (
    'BOSCH','MANN','MAHLE','BREMBO','TRW','FRAM','PURFLUX','CHAMPION','FERODO',
    'GATES','SKF','NGK','NTK','DENSO','VALEO','MOOG','KAYABA','MONROE','ATE',
    'AISIN','LUK','CONTITECH','LEMFORDER','FAG','DOLZ','EXIDE','VARTA','TOTAL',
    'CASTROL','SAMSUNG'
  );

UPDATE public.master_catalog_items
SET manufacturer_ref = ''
WHERE manufacturer_ref IS NOT NULL AND manufacturer_ref <> ''
  AND (
    manufacturer_ref ILIKE 'KIT-%' OR
    manufacturer_ref ILIKE 'AMPLI-%' OR
    manufacturer_ref ILIKE 'RADAR-%' OR
    manufacturer_ref ILIKE 'HP-%' OR
    manufacturer_ref ILIKE 'SUB-%' OR
    manufacturer_ref ILIKE 'TWT-%' OR
    manufacturer_ref ILIKE 'CMD-VOL-%' OR
    manufacturer_ref ILIKE 'VOLAN-%' OR
    manufacturer_ref ILIKE 'PROJ-%' OR
    manufacturer_ref ILIKE '%UNIV%'
  );
