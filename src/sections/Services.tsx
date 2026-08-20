import { MAX_DURATION_S } from '../lib/constants';
import '../styles/components/services.css';

interface Offer {
  title: string;
  body: string;
  detail: string;
}

const OFFERS: Offer[] = [
  {
    title: 'Nettoyage à l’épisode',
    body: 'Vous envoyez la prise brute, vous récupérez un fichier monté au niveau, prêt à publier. Souffle, ronflement, plosives, sifflantes.',
    detail: 'Podcast, interview, cours enregistré',
  },
  {
    title: 'Sauvetage de prise',
    body: 'La captation est ratée et il n’y aura pas de deuxième prise. On regarde ensemble ce qui est récupérable — et je le dis quand ça ne l’est pas.',
    detail: 'Conférence, terrain, archive',
  },
  {
    title: 'Chaîne sur mesure',
    body: 'Vous produisez à la série et vous voulez le même traitement à chaque fois. Je règle la chaîne sur vos prises, vous la relancez seul.',
    detail: 'Traitement par lot, réglages livrés',
  },
  {
    title: 'Avis avant d’enregistrer',
    body: 'La moitié du travail se fait avant. Placement du micro, traitement de la pièce, réglage de gain : une heure d’appel évite dix heures de rattrapage.',
    detail: 'Conseil, à l’heure',
  },
];

export function Services() {
  return (
    <section className="section services" id="services">
      <div className="shell">
        <div className="section__head">
          <p className="kicker">03 — Prestations</p>
          <div>
            <h2 className="display section__title">Ce que je fais, concrètement</h2>
            <p className="prose">
              Auto-entreprise, un seul interlocuteur. Devis à la prise ou au forfait, selon
              ce qui est le plus simple pour vous.
            </p>
          </div>
        </div>

        <ul className="services__grid">
          {OFFERS.map((offer) => (
            <li className="services__card" key={offer.title}>
              <p className="kicker">{offer.detail}</p>
              <h3 className="services__title">{offer.title}</h3>
              <p className="services__body">{offer.body}</p>
            </li>
          ))}
        </ul>

        <p className="services__limit">
          <span className="notice__label">Démo</span>
          <span>
            La démonstration s’arrête à <span className="mono">{MAX_DURATION_S}</span>&nbsp;s{' '}
            — c’est ce qu’un navigateur traite confortablement sans faire chauffer votre
            machine. Pour vos fichiers entiers, écrivez-moi&nbsp;: c’est le même traitement,
            sans la limite.
          </span>
        </p>
      </div>
    </section>
  );
}
