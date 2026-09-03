import { formatDate } from '../../lib/format';
import {
  fmtMoney, fmtNum, pct, fmtRate,
  type ReportData, type DateRange,
} from './reportEngine';
import {
  MetricStrip, SectionTitle, ReportTable, AmountNote, DailyBars, DASH,
  thCls, thR, thC, tdCls, tdR, tdC, tdMuted, totalTd, totalTdR,
  type Metric,
} from './reportPrimitives';

const signed = (n: number) => (n < 0 ? `− ${fmtMoney(Math.abs(n))}` : fmtMoney(n));
const dashMoney = (n: number) => (n > 0 ? fmtMoney(n) : DASH);

function Row({ children }: { children: React.ReactNode }) {
  return <tr className="hover:bg-neutral-50 transition-colors">{children}</tr>;
}

export function ReportScreen({
  data, showMargin, hideZero, range,
}: {
  data: ReportData;
  showMargin: boolean;
  hideZero: boolean;
  range: DateRange;
}) {
  switch (data.type) {
    case 'cash': return <CashScreen stats={data.stats} showMargin={showMargin} range={range} />;
    case 'articles': return <ArticlesScreen rows={data.rows} showMargin={showMargin} />;
    case 'customers': return <CustomersScreen stats={data.stats} showMargin={showMargin} />;
    case 'suppliers': return <SuppliersScreen stats={data.stats} />;
    case 'expenses': return <ExpensesScreen stats={data.stats} />;
    case 'tiers_balance': return <TiersScreen stats={data.stats} hideZero={hideZero} />;
  }
}

// ── Cash ───────────────────────────────────────────────────────────────────────

function CashScreen({ stats, showMargin }: { stats: Extract<ReportData, { type: 'cash' }>['stats']; showMargin: boolean; range: DateRange }) {
  const s = stats;
  const metrics: Metric[] = [
    { label: 'Solde initial', value: fmtMoney(s.fondsOuverture) },
    { label: 'Entrées réelles', value: `+ ${fmtMoney(s.totalEntrees)}` },
    { label: 'Sorties réelles', value: `− ${fmtMoney(s.totalSorties)}` },
    { label: 'Solde théorique', value: signed(s.soldeTheorique) },
  ];

  return (
    <div>
      <MetricStrip items={metrics} />

      {s.parJour.length > 1 && (
        <>
          <SectionTitle>Évolution journalière de la caisse</SectionTitle>
          <DailyBars data={s.parJour.map((d) => ({ date: d.date, value: d.solde, label: `${formatDate(d.date)} · ${signed(d.solde)}` }))} />
        </>
      )}

      <SectionTitle note="Chaque flux compté une seule fois">Flux de trésorerie réels</SectionTitle>
      <AmountNote />
      <ReportTable>
        <thead>
          <tr><th className={thCls}>Mouvement de caisse</th><th className={thR}>Montant</th></tr>
        </thead>
        <tbody>
          <Row><td className={tdCls}>Fonds d'ouverture</td><td className={tdR + ' font-semibold'}>{fmtMoney(s.fondsOuverture)}</td></Row>
          <Row><td className={tdCls}>Règlements clients encaissés</td><td className={tdR}>+ {fmtMoney(s.reglementsClients)}</td></Row>
          <Row><td className={tdCls}>Autres entrées</td><td className={tdR}>+ {fmtMoney(s.autresEntrees)}</td></Row>
          <Row><td className={tdCls + ' font-semibold'}>Total des entrées</td><td className={tdR + ' font-semibold'}>+ {fmtMoney(s.totalEntrees)}</td></Row>
          <Row><td className={tdCls}>Règlements fournisseurs décaissés</td><td className={tdR}>− {fmtMoney(s.reglementsFournisseurs)}</td></Row>
          <Row><td className={tdCls}>Dépenses payées</td><td className={tdR}>− {fmtMoney(s.depensesPayees)}</td></Row>
          <Row><td className={tdCls}>Remboursements clients décaissés</td><td className={tdR}>− {fmtMoney(s.remboursementsClients)}</td></Row>
          <Row><td className={tdCls}>Autres sorties</td><td className={tdR}>− {fmtMoney(s.autresSorties)}</td></Row>
          <Row><td className={tdCls + ' font-semibold'}>Total des sorties</td><td className={tdR + ' font-semibold'}>− {fmtMoney(s.totalSorties)}</td></Row>
          <tr><td className={totalTd}>Solde théorique de caisse</td><td className={totalTdR}>{signed(s.soldeTheorique)}</td></tr>
        </tbody>
      </ReportTable>

      <SectionTitle>Activité commerciale</SectionTitle>
      <MetricStrip items={[
        { label: 'Ventes validées', value: fmtMoney(s.ventesValidees) },
        { label: 'Retours / avoirs', value: s.retours > 0 ? `− ${fmtMoney(s.retours)}` : fmtMoney(0) },
        { label: 'CA net', value: fmtMoney(s.caNet) },
        { label: 'Nb ventes', value: fmtNum(s.nbVentes), hint: s.nbRetours > 0 ? `${fmtNum(s.nbRetours)} retour(s)` : undefined },
      ]} />

      {showMargin && (
        <>
          <SectionTitle>Rentabilité</SectionTitle>
          <MetricStrip items={[
            { label: 'Coût des marchandises', value: fmtMoney(s.cogsNet) },
            { label: 'Marge brute', value: signed(s.margeBrute) },
            { label: 'Taux de marge', value: fmtRate(s.tauxMarge) },
            { label: 'Lignes sans coût', value: fmtNum(s.nbLignesSansCout) },
          ]} />
          {s.nbLignesSansCout > 0 && (
            <p className="mt-3 pl-3 border-l-2 border-neutral-900 text-[12px] text-neutral-600 leading-relaxed">
              Marge non fiabilisée : {fmtNum(s.nbLignesSansCout)} ligne(s) sans coût historique. Le taux de marge est probablement surévalué tant que ces coûts d'achat ne sont pas renseignés.
            </p>
          )}
        </>
      )}

      <SectionTitle>Ventilation par mode de règlement</SectionTitle>
      <AmountNote />
      <ReportTable minWidth={480}>
        <thead>
          <tr><th className={thCls}>Mode de règlement</th><th className={thR}>Entrées</th><th className={thR}>Sorties</th><th className={thR}>Net</th></tr>
        </thead>
        <tbody>
          {s.parMode.length ? s.parMode.map((m, i) => (
            <Row key={i}>
              <td className={tdCls + ' font-semibold'}>{m.method}</td>
              <td className={tdR}>{m.entrees > 0 ? `+ ${fmtMoney(m.entrees)}` : DASH}</td>
              <td className={m.sorties > 0 ? tdR : tdMuted + ' text-right'}>{m.sorties > 0 ? `− ${fmtMoney(m.sorties)}` : DASH}</td>
              <td className={tdR + ' font-semibold'}>{signed(m.net)}</td>
            </Row>
          )) : <tr><td className={tdMuted + ' text-center'} colSpan={4}>Aucun mouvement</td></tr>}
        </tbody>
      </ReportTable>

      <SectionTitle note={`Top ${Math.min(50, s.articles.length)}`}>Articles vendus</SectionTitle>
      <AmountNote />
      <ReportTable minWidth={showMargin ? 620 : 460}>
        <thead>
          <tr>
            <th className={thC} style={{ width: 36 }}>#</th>
            <th className={thCls}>Article</th>
            <th className={thR}>Qté</th>
            <th className={thR}>CA</th>
            <th className={thR}>Part CA</th>
            {showMargin && <th className={thR}>Marge</th>}
            {showMargin && <th className={thR}>Tx marge</th>}
          </tr>
        </thead>
        <tbody>
          {s.articles.length ? s.articles.slice(0, 50).map((a, i) => {
            const m = a.revenue - a.cost;
            return (
              <Row key={i}>
                <td className={tdC}>{i + 1}</td>
                <td className={tdCls}>{a.name}</td>
                <td className={tdR}>{fmtNum(a.qty)}</td>
                <td className={tdR + ' font-semibold'}>{fmtMoney(a.revenue)}</td>
                <td className={tdR}>{pct(a.revenue, s.caNet)}</td>
                {showMargin && <td className={tdR}>{signed(m)}</td>}
                {showMargin && <td className={tdR}>{a.revenue > 0 ? Math.round((m / a.revenue) * 100) : 0} %</td>}
              </Row>
            );
          }) : <tr><td className={tdMuted + ' text-center'} colSpan={showMargin ? 7 : 5}>Aucune vente</td></tr>}
        </tbody>
      </ReportTable>
    </div>
  );
}

// ── Articles ─────────────────────────────────────────────────────────────────

function ArticlesScreen({ rows, showMargin }: { rows: Extract<ReportData, { type: 'articles' }>['rows']; showMargin: boolean }) {
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalCost = rows.reduce((s, r) => s + r.cost, 0);
  const totalQty = rows.reduce((s, r) => s + r.qty, 0);
  const totalReturned = rows.reduce((s, r) => s + r.qtyReturned, 0);
  const margin = totalRevenue - totalCost;
  const rate = totalRevenue > 0 ? Math.round((margin / totalRevenue) * 100) : 0;

  return (
    <div>
      <MetricStrip items={showMargin
        ? [
            { label: 'CA net', value: fmtMoney(totalRevenue) },
            { label: 'Quantité vendue', value: fmtNum(totalQty) },
            { label: 'Marge brute', value: signed(margin) },
            { label: 'Taux de marque', value: `${rate} %` },
          ]
        : [
            { label: 'CA net', value: fmtMoney(totalRevenue) },
            { label: 'Quantité vendue', value: fmtNum(totalQty) },
            { label: 'Références vendues', value: fmtNum(rows.length) },
            { label: 'Quantité retournée', value: totalReturned > 0 ? fmtNum(totalReturned) : DASH },
          ]} />

      <SectionTitle>Classement des articles — CA décroissant</SectionTitle>
      <AmountNote />
      <ReportTable minWidth={showMargin ? 640 : 540}>
        <thead>
          <tr>
            <th className={thC} style={{ width: 36 }}>#</th>
            <th className={thCls}>Article</th>
            <th className={thR}>Qté vendue</th>
            <th className={thR}>Qté retournée</th>
            <th className={thR}>CA net</th>
            <th className={thR}>Part CA</th>
            {showMargin && <th className={thR}>Marge</th>}
            {showMargin && <th className={thR}>Tx marge</th>}
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((r, i) => (
            <Row key={i}>
              <td className={tdC}>{i + 1}</td>
              <td className={tdCls}>{r.name}</td>
              <td className={tdR}>{fmtNum(r.qty)}</td>
              <td className={r.qtyReturned > 0 ? tdR : tdMuted + ' text-right'}>{r.qtyReturned > 0 ? fmtNum(r.qtyReturned) : DASH}</td>
              <td className={tdR + ' font-semibold'}>{fmtMoney(r.revenue)}</td>
              <td className={tdR}>{pct(r.revenue, totalRevenue)}</td>
              {showMargin && <td className={tdR}>{signed(r.margin)}</td>}
              {showMargin && <td className={tdR}>{r.tauxMarge} %</td>}
            </Row>
          )) : <tr><td className={tdMuted + ' text-center'} colSpan={showMargin ? 8 : 6}>Aucune vente sur la période</td></tr>}
          {rows.length > 0 && (
            <tr>
              <td className={totalTd}></td>
              <td className={totalTd}>Total</td>
              <td className={totalTdR}>{fmtNum(totalQty)}</td>
              <td className={totalTdR}>{totalReturned > 0 ? fmtNum(totalReturned) : DASH}</td>
              <td className={totalTdR}>{fmtMoney(totalRevenue)}</td>
              <td className={totalTdR}>100 %</td>
              {showMargin && <td className={totalTdR}>{signed(margin)}</td>}
              {showMargin && <td className={totalTd}></td>}
            </tr>
          )}
        </tbody>
      </ReportTable>
    </div>
  );
}

// ── Customers ────────────────────────────────────────────────────────────────

function CustomersScreen({ stats, showMargin }: { stats: Extract<ReportData, { type: 'customers' }>['stats']; showMargin: boolean }) {
  const { rows, totals, asOf } = stats;
  const tn = (k: string) => Number(totals?.[k]) || 0;
  const asOfLabel = formatDate(asOf);
  const activity = rows.filter((r) => r.nbVentes > 0 || r.retours > 0);
  const withSituation = rows.filter((r) => r.montantDu > 0 || r.creditDisponible > 0);

  return (
    <div>
      <MetricStrip items={[
        { label: 'CA net période', value: fmtMoney(tn('ca_net')) },
        { label: 'Encaissements', value: fmtMoney(tn('encaissements')) },
        { label: `Montant dû au ${asOfLabel}`, value: fmtMoney(tn('montant_du')) },
        { label: 'Crédit disponible', value: fmtMoney(tn('credit_disponible')) },
      ]} />

      <SectionTitle note="CA net décroissant">Activité de la période</SectionTitle>
      <AmountNote />
      <ReportTable minWidth={showMargin ? 640 : 560}>
        <thead>
          <tr>
            <th className={thC} style={{ width: 36 }}>#</th>
            <th className={thCls}>Client</th>
            <th className={thR}>Nb ventes</th>
            <th className={thR}>CA HT</th>
            <th className={thR}>Remises</th>
            <th className={thR}>Retours</th>
            <th className={thR}>CA net</th>
            {showMargin && <th className={thR}>Marge</th>}
          </tr>
        </thead>
        <tbody>
          {activity.length ? activity.map((r, i) => (
            <Row key={i}>
              <td className={tdC}>{i + 1}</td>
              <td className={tdCls + ' font-semibold'}>{r.name}{r.isShared && <span className="text-neutral-400 font-normal"> (partagé)</span>}</td>
              <td className={tdR}>{fmtNum(r.nbVentes)}</td>
              <td className={tdR}>{fmtMoney(r.caHt)}</td>
              <td className={r.remises > 0 ? tdR : tdMuted + ' text-right'}>{r.remises > 0 ? fmtMoney(r.remises) : DASH}</td>
              <td className={r.retours > 0 ? tdR : tdMuted + ' text-right'}>{r.retours > 0 ? fmtMoney(r.retours) : DASH}</td>
              <td className={tdR + ' font-semibold'}>{fmtMoney(r.caNet)}</td>
              {showMargin && <td className={tdR}>{signed(r.marge)}</td>}
            </Row>
          )) : <tr><td className={tdMuted + ' text-center'} colSpan={showMargin ? 8 : 7}>Aucune activité sur la période</td></tr>}
          {activity.length > 0 && (
            <tr>
              <td className={totalTd}></td>
              <td className={totalTd}>Total</td>
              <td className={totalTdR}>{fmtNum(activity.reduce((s, r) => s + r.nbVentes, 0))}</td>
              <td className={totalTdR}>{fmtMoney(tn('ca_ht'))}</td>
              <td className={totalTdR}>{fmtMoney(tn('remises'))}</td>
              <td className={totalTdR}>{fmtMoney(tn('retours'))}</td>
              <td className={totalTdR}>{fmtMoney(tn('ca_net'))}</td>
              {showMargin && <td className={totalTdR}>{signed(tn('marge'))}</td>}
            </tr>
          )}
        </tbody>
      </ReportTable>

      <SectionTitle>Situation financière au {asOfLabel}</SectionTitle>
      <AmountNote />
      <ReportTable minWidth={620}>
        <thead>
          <tr>
            <th className={thC} style={{ width: 36 }}>#</th>
            <th className={thCls}>Client</th>
            <th className={thR}>Encaissements</th>
            <th className={thR}>Solde antérieur</th>
            <th className={thR}>Montant dû</th>
            <th className={thR}>Crédit dispo.</th>
            <th className={thR}>Solde à date</th>
          </tr>
        </thead>
        <tbody>
          {withSituation.length ? withSituation.map((r, i) => (
            <Row key={i}>
              <td className={tdC}>{i + 1}</td>
              <td className={tdCls + ' font-semibold'}>
                {r.name}
                {r.status === 'prior_only' && <span className="text-neutral-400 font-normal"> — Solde antérieur — aucune activité sur la période</span>}
              </td>
              <td className={tdR}>{dashMoney(r.encaissements)}</td>
              <td className={tdR}>{fmtMoney(r.soldeAnterieur)}</td>
              <td className={tdR + ' font-semibold'}>{dashMoney(r.montantDu)}</td>
              <td className={r.creditDisponible > 0 ? tdR : tdMuted + ' text-right'}>{dashMoney(r.creditDisponible)}</td>
              <td className={tdR + ' font-semibold'}>{r.soldeADate !== 0 ? signed(r.soldeADate) : DASH}</td>
            </Row>
          )) : <tr><td className={tdMuted + ' text-center'} colSpan={7}>Aucun solde</td></tr>}
          {withSituation.length > 0 && (
            <tr>
              <td className={totalTd}></td>
              <td className={totalTd}>Total</td>
              <td className={totalTdR}>{fmtMoney(tn('encaissements'))}</td>
              <td className={totalTd}></td>
              <td className={totalTdR}>{fmtMoney(tn('montant_du'))}</td>
              <td className={totalTdR}>{fmtMoney(tn('credit_disponible'))}</td>
              <td className={totalTd}></td>
            </tr>
          )}
        </tbody>
      </ReportTable>
    </div>
  );
}

// ── Suppliers ────────────────────────────────────────────────────────────────

function SuppliersScreen({ stats }: { stats: Extract<ReportData, { type: 'suppliers' }>['stats'] }) {
  const { rows, totals, asOf } = stats;
  const tn = (k: string) => Number(totals?.[k]) || 0;
  const asOfLabel = formatDate(asOf);

  return (
    <div>
      <MetricStrip items={[
        { label: 'Achats de la période', value: fmtMoney(tn('total_achats')) },
        { label: 'Règlements', value: fmtMoney(tn('reglements')) },
        { label: 'Dette antérieure', value: fmtMoney(tn('dette_anterieure')) },
        { label: `Dette au ${asOfLabel}`, value: fmtMoney(tn('dette_a_date')) },
      ]} />

      <SectionTitle>Fournisseurs — achats & dette au {asOfLabel}</SectionTitle>
      <AmountNote />
      <ReportTable minWidth={760}>
        <thead>
          <tr>
            <th className={thC} style={{ width: 36 }}>#</th>
            <th className={thCls}>Fournisseur</th>
            <th className={thR}>Commandes</th>
            <th className={thR}>Achats période</th>
            <th className={thR}>Règlements</th>
            <th className={thR}>Avances</th>
            <th className={thR}>Dette antérieure</th>
            <th className={thR}>Dette à date</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((r, i) => (
            <Row key={i}>
              <td className={tdC}>{i + 1}</td>
              <td className={tdCls + ' font-semibold'}>
                {r.name}
                {r.isShared && <span className="text-neutral-400 font-normal"> (partagé)</span>}
                {r.status === 'prior_only' && <span className="text-neutral-400 font-normal"> — dette antérieure, aucun achat sur la période</span>}
              </td>
              <td className={tdR}>{fmtNum(r.nbCommandes)}</td>
              <td className={tdR + ' font-semibold'}>{fmtMoney(r.totalAchats)}</td>
              <td className={tdR}>{dashMoney(r.reglements)}</td>
              <td className={r.avances > 0 ? tdR : tdMuted + ' text-right'}>{dashMoney(r.avances)}</td>
              <td className={tdR}>{fmtMoney(r.detteAnterieure)}</td>
              <td className={tdR + ' font-semibold'}>{dashMoney(r.detteADate)}</td>
            </Row>
          )) : <tr><td className={tdMuted + ' text-center'} colSpan={8}>Aucun fournisseur</td></tr>}
          {rows.length > 0 && (
            <tr>
              <td className={totalTd}></td>
              <td className={totalTd}>Total</td>
              <td className={totalTdR}>{fmtNum(rows.reduce((s, r) => s + r.nbCommandes, 0))}</td>
              <td className={totalTdR}>{fmtMoney(tn('total_achats'))}</td>
              <td className={totalTdR}>{fmtMoney(tn('reglements'))}</td>
              <td className={totalTdR}>{fmtMoney(tn('avances'))}</td>
              <td className={totalTd}></td>
              <td className={totalTdR}>{fmtMoney(tn('dette_a_date'))}</td>
            </tr>
          )}
        </tbody>
      </ReportTable>
    </div>
  );
}

// ── Expenses ─────────────────────────────────────────────────────────────────

function ExpensesScreen({ stats }: { stats: Extract<ReportData, { type: 'expenses' }>['stats'] }) {
  const s = stats;
  const topCategory = s.byCategory.slice().sort((a, b) => b.amount - a.amount)[0];

  return (
    <div>
      <MetricStrip items={[
        { label: 'Dépenses validées', value: fmtMoney(s.expensesTotal) },
        { label: 'Nombre de dépenses', value: fmtNum(s.expensesCount) },
        { label: 'Catégorie principale', value: topCategory ? topCategory.category : DASH },
        { label: "Résultat d'exploitation", value: signed(s.resultatExploitation) },
      ]} />

      <SectionTitle>Résultat d'exploitation</SectionTitle>
      <AmountNote />
      <ReportTable>
        <thead>
          <tr><th className={thCls}>Élément</th><th className={thR}>Montant</th></tr>
        </thead>
        <tbody>
          <Row><td className={tdCls}>Ventes validées</td><td className={tdR + ' font-semibold'}>{fmtMoney(s.ventesValidees)}</td></Row>
          <Row><td className={tdCls}>Retours / avoirs</td><td className={tdR}>− {fmtMoney(s.retours)}</td></Row>
          <Row><td className={tdCls + ' font-semibold'}>CA net</td><td className={tdR + ' font-semibold'}>{fmtMoney(s.caNet)}</td></Row>
          <Row><td className={tdCls}>Coût des marchandises</td><td className={tdR}>− {fmtMoney(s.cogsNet)}</td></Row>
          <Row><td className={tdCls + ' font-semibold'}>Marge brute</td><td className={tdR + ' font-semibold'}>{signed(s.margeBrute)}</td></Row>
          <Row><td className={tdCls}>Charges d'exploitation</td><td className={tdR}>− {fmtMoney(s.chargesExploitation)}</td></Row>
          <tr><td className={totalTd}>Résultat d'exploitation</td><td className={totalTdR}>{signed(s.resultatExploitation)}</td></tr>
        </tbody>
      </ReportTable>
      {s.nbLignesSansCout > 0 && (
        <p className="mt-3 pl-3 border-l-2 border-neutral-900 text-[12px] text-neutral-600 leading-relaxed">
          Marge non fiabilisée : {fmtNum(s.nbLignesSansCout)} ligne(s) sans coût historique. Le taux de marge ({fmtRate(s.tauxMarge)}) est probablement surévalué tant que ces coûts d'achat ne sont pas renseignés.
        </p>
      )}

      <SectionTitle>Dépenses d'exploitation par catégorie</SectionTitle>
      <AmountNote />
      <ReportTable minWidth={460}>
        <thead>
          <tr>
            <th className={thC} style={{ width: 36 }}>#</th>
            <th className={thCls}>Catégorie</th>
            <th className={thR}>Nombre</th>
            <th className={thR}>Montant</th>
            <th className={thR}>Part</th>
          </tr>
        </thead>
        <tbody>
          {s.byCategory.length ? s.byCategory.map((c, i) => (
            <Row key={i}>
              <td className={tdC}>{i + 1}</td>
              <td className={tdCls + ' font-semibold'}>{c.category}</td>
              <td className={tdR}>{fmtNum(c.count)}</td>
              <td className={tdR + ' font-semibold'}>{fmtMoney(c.amount)}</td>
              <td className={tdR}>{pct(c.amount, s.expensesTotal)}</td>
            </Row>
          )) : <tr><td className={tdMuted + ' text-center'} colSpan={5}>Aucune dépense sur la période</td></tr>}
          {s.byCategory.length > 0 && (
            <tr>
              <td className={totalTd}></td>
              <td className={totalTd}>Total</td>
              <td className={totalTdR}>{fmtNum(s.byCategory.reduce((a, c) => a + c.count, 0))}</td>
              <td className={totalTdR}>{fmtMoney(s.expensesTotal)}</td>
              <td className={totalTdR}>100 %</td>
            </tr>
          )}
        </tbody>
      </ReportTable>

      {s.byMode.length > 0 && (
        <>
          <SectionTitle>Dépenses par mode de règlement</SectionTitle>
          <AmountNote />
          <ReportTable minWidth={420}>
            <thead>
              <tr>
                <th className={thCls}>Mode de règlement</th>
                <th className={thR}>Nombre</th>
                <th className={thR}>Montant</th>
                <th className={thR}>Part</th>
              </tr>
            </thead>
            <tbody>
              {s.byMode.map((m, i) => (
                <Row key={i}>
                  <td className={tdCls + ' font-semibold'}>{m.method}</td>
                  <td className={tdR}>{fmtNum(m.count)}</td>
                  <td className={tdR + ' font-semibold'}>{fmtMoney(m.amount)}</td>
                  <td className={tdR}>{pct(m.amount, s.expensesTotal)}</td>
                </Row>
              ))}
            </tbody>
          </ReportTable>
        </>
      )}

      <SectionTitle note={s.detail.length > 200 ? `200 premières sur ${s.detail.length}` : undefined}>Détail des dépenses</SectionTitle>
      <AmountNote />
      <ReportTable minWidth={640}>
        <thead>
          <tr>
            <th className={thC} style={{ width: 36 }}>#</th>
            <th className={thCls}>Date</th>
            <th className={thCls}>Catégorie</th>
            <th className={thCls}>Mode</th>
            <th className={thCls}>Motif / note</th>
            <th className={thR}>Montant</th>
          </tr>
        </thead>
        <tbody>
          {s.detail.length ? s.detail.slice(0, 200).map((d, i) => (
            <Row key={i}>
              <td className={tdC}>{i + 1}</td>
              <td className={tdCls}>{new Date(d.date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</td>
              <td className={tdCls + ' font-semibold'}>{d.category}</td>
              <td className={tdCls}>{d.method}</td>
              <td className={tdMuted}>{d.note || DASH}</td>
              <td className={tdR + ' font-semibold'}>{fmtMoney(d.amount)}</td>
            </Row>
          )) : <tr><td className={tdMuted + ' text-center'} colSpan={6}>Aucune dépense sur la période</td></tr>}
        </tbody>
      </ReportTable>
    </div>
  );
}

// ── Tiers balance ────────────────────────────────────────────────────────────

function TiersScreen({ stats, hideZero }: { stats: Extract<ReportData, { type: 'tiers_balance' }>['stats']; hideZero: boolean }) {
  const { customers, suppliers, totals, asOf } = stats;
  const asOfLabel = formatDate(asOf);
  const custDue = Number(totals?.customers?.due) || 0;
  const custCredit = Number(totals?.customers?.credit) || 0;
  const supDue = Number(totals?.suppliers?.due) || 0;
  const supAdvance = Number(totals?.suppliers?.advance) || 0;
  const netPosition = custDue - supDue;

  const filterFn = (r: { net: number }) => !hideZero || r.net !== 0;
  const shownCustomers = customers.filter(filterFn);
  const shownSuppliers = suppliers.filter(filterFn);
  const nonZeroCount = customers.length + suppliers.length;

  return (
    <div>
      <MetricStrip items={[
        { label: 'Créances clients', value: fmtMoney(custDue) },
        { label: 'Crédits clients', value: fmtMoney(custCredit) },
        { label: 'Dettes fournisseurs', value: fmtMoney(supDue) },
        { label: 'Position nette', value: signed(netPosition) },
      ]} />

      <SectionTitle note={hideZero ? 'Soldes non nuls' : undefined}>Créances clients — Situation au {asOfLabel}</SectionTitle>
      <AmountNote />
      <ReportTable minWidth={420}>
        <thead>
          <tr>
            <th className={thC} style={{ width: 36 }}>#</th>
            <th className={thCls}>Client</th>
            <th className={thR}>Montant dû</th>
            <th className={thR}>Crédit / avoir</th>
          </tr>
        </thead>
        <tbody>
          {shownCustomers.length ? shownCustomers.map((r, i) => (
            <Row key={r.id}>
              <td className={tdC}>{i + 1}</td>
              <td className={tdCls + ' font-semibold'}>{r.name}</td>
              <td className={tdR + ' font-semibold'}>{dashMoney(r.due)}</td>
              <td className={r.credit > 0 ? tdR : tdMuted + ' text-right'}>{dashMoney(r.credit)}</td>
            </Row>
          )) : <tr><td className={tdMuted + ' text-center'} colSpan={4}>Aucun client avec solde</td></tr>}
          {shownCustomers.length > 0 && (
            <tr>
              <td className={totalTd}></td>
              <td className={totalTd}>Total</td>
              <td className={totalTdR}>{fmtMoney(custDue)}</td>
              <td className={totalTdR}>{fmtMoney(custCredit)}</td>
            </tr>
          )}
        </tbody>
      </ReportTable>

      <SectionTitle note={hideZero ? 'Soldes non nuls' : undefined}>Dettes fournisseurs — Situation au {asOfLabel}</SectionTitle>
      <AmountNote />
      <ReportTable minWidth={420}>
        <thead>
          <tr>
            <th className={thC} style={{ width: 36 }}>#</th>
            <th className={thCls}>Fournisseur</th>
            <th className={thR}>Dette</th>
            <th className={thR}>Avance</th>
          </tr>
        </thead>
        <tbody>
          {shownSuppliers.length ? shownSuppliers.map((r, i) => (
            <Row key={r.id}>
              <td className={tdC}>{i + 1}</td>
              <td className={tdCls + ' font-semibold'}>{r.name}</td>
              <td className={tdR + ' font-semibold'}>{dashMoney(r.due)}</td>
              <td className={r.credit > 0 ? tdR : tdMuted + ' text-right'}>{dashMoney(r.credit)}</td>
            </Row>
          )) : <tr><td className={tdMuted + ' text-center'} colSpan={4}>Aucun fournisseur avec solde</td></tr>}
          {shownSuppliers.length > 0 && (
            <tr>
              <td className={totalTd}></td>
              <td className={totalTd}>Total</td>
              <td className={totalTdR}>{fmtMoney(supDue)}</td>
              <td className={totalTdR}>{fmtMoney(supAdvance)}</td>
            </tr>
          )}
        </tbody>
      </ReportTable>

      <SectionTitle note={`${fmtNum(nonZeroCount)} tiers`}>Synthèse de la position nette</SectionTitle>
      <AmountNote />
      <ReportTable>
        <thead>
          <tr><th className={thCls}>Élément</th><th className={thR}>Montant</th></tr>
        </thead>
        <tbody>
          <Row><td className={tdCls + ' font-semibold'}>Total créances clients</td><td className={tdR}>{fmtMoney(custDue)}</td></Row>
          <Row><td className={tdCls + ' font-semibold'}>Total dettes fournisseurs</td><td className={tdR}>{fmtMoney(supDue)}</td></Row>
          <tr><td className={totalTd}>Position nette (créances − dettes)</td><td className={totalTdR}>{signed(netPosition)}</td></tr>
        </tbody>
      </ReportTable>
    </div>
  );
}
