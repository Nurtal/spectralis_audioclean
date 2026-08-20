import { Hero } from './sections/Hero';
import { Demo } from './sections/Demo';
import { HowItWorks } from './sections/HowItWorks';
import { Services } from './sections/Services';
import { Contact } from './sections/Contact';
import './styles/components/chrome.css';

const YEAR = new Date().getFullYear();

export default function App() {
  return (
    <>
      <a className="skip-link" href="#demo">
        Aller à la démonstration
      </a>

      <nav className="topbar" aria-label="Principal">
        <div className="shell topbar__inner">
          <a className="topbar__brand" href="#top">
            <span className="display topbar__name">Spectralis</span>
            <span className="kicker topbar__tag">traitement audio</span>
          </a>
          <ul className="topbar__links mono">
            <li>
              <a href="#demo">Démo</a>
            </li>
            <li>
              <a href="#methode">Méthode</a>
            </li>
            <li>
              <a href="#services">Prestations</a>
            </li>
            <li>
              <a href="#contact">Contact</a>
            </li>
          </ul>
        </div>
      </nav>

      <div id="top" />
      <Hero />

      <main>
        <Demo />
        <HowItWorks />
        <Services />
        <Contact />
      </main>

      <footer className="footer">
        <div className="shell footer__inner">
          <p className="mono footer__line">
            © {YEAR} Spectralis · Auto-entreprise · Site statique, sans cookie ni mesure
            d’audience
          </p>
          <p className="mono footer__line footer__line--muted">
            Traitement exécuté dans votre navigateur · RNNoise sous licence BSD ·
            construit avec Vite
          </p>
        </div>
      </footer>
    </>
  );
}
