import { MAX_DURATION_S, TARGET_LUFS } from '../lib/constants';
import { minus } from '../lib/format';
import '../styles/components/hero.css';

/**
 * Le hero porte l'argument, pas une promesse.
 *
 * « Le fichier ne quitte jamais votre machine » est à la fois la contrainte
 * technique et le pitch commercial : il est donc en gros, au-dessus de la
 * ligne de flottaison, et pas au fond des mentions légales.
 */
export function Hero() {
  return (
    <header className="hero">
      <div className="shell hero__grid">
        <div className="hero__main">
          <p className="kicker hero__kicker">Traitement audio · auto-entreprise · Nantes</p>

          <h1 className="display hero__title">
            Vos enregistrements de voix,
            <br />
            débarrassés de ce qu’il y a autour.
          </h1>

          <p className="lede hero__lede">
            Climatisation, souffle de préampli, rue derrière la fenêtre. On retire le fond
            sans toucher à la voix, et on vous rend un fichier au bon niveau, prêt à
            publier.
          </p>

          <p className="hero__claim">
            <span>
              <strong>Votre fichier ne quitte pas votre machine.</strong> La démonstration
              ci-dessous s’exécute entièrement dans votre navigateur : aucun envoi, aucun
              serveur, aucun compte. Coupez le réseau après le chargement de la page, elle
              marchera toujours.
            </span>
          </p>

          <div className="hero__actions">
            <a className="button button--solid" href="#demo">
              Essayer sur un extrait
            </a>
            <a className="button" href="#services">
              Ce que je fais
            </a>
          </div>
        </div>

        <aside className="hero__spec plate" aria-label="Fiche technique de la démonstration">
          <div className="plate__head">
            <span className="kicker">Fiche technique</span>
            <span className="kicker">démo</span>
          </div>
          <dl className="hero__specList">
            {[
              ['Envoi réseau', '0 octet'],
              ['Traitement', 'navigateur'],
              ['Durée analysée', `${MAX_DURATION_S} s max`],
              ['Fréquence', '48 kHz mono'],
              ['Débruitage', 'RNN ou spectral'],
              ['Sortie', `${minus(String(TARGET_LUFS))} LUFS · −1 dBTP`],
              ['Export', 'WAV 16 bits'],
            ].map(([term, value]) => (
              <div className="hero__specRow" key={term}>
                <dt>{term}</dt>
                <dd className="mono">{value}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>
    </header>
  );
}
