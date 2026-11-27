import { BookOpen, Download } from './Icons';
import './accounting-guide.css';

const guideHtml = '/guides/guide-comptabilite-waarwi.html';
const guidePdf = '/guides/guide-comptabilite-waarwi.pdf';

export function AccountingGuide() {
  return (
    <section className="acc-guide">
      <div className="acc-toolbar acc-fixed">
        <a className="btn-secondary" href={guideHtml} target="_blank" rel="noopener">
          <BookOpen size={16} aria-hidden="true" />
          Ouvrir le guide
        </a>
        <a className="btn-primary" href={guidePdf} download>
          <Download size={16} aria-hidden="true" />
          Télécharger le PDF
        </a>
      </div>
      <iframe className="acc-guide-frame" title="Guide d’utilisation de la comptabilité Waarwi" src={guideHtml} />
    </section>
  );
}
