import '../styles/components/contact.css';

/*
 * Adresse et coordonnées : à remplacer par les vôtres avant mise en ligne
 * (cf. docs/design.md, « ce qu'il reste à renseigner »).
 */
const EMAIL = 'bonjour@spectralis.fr';

export function Contact() {
  return (
    <section className="section contact" id="contact">
      <div className="shell contact__grid">
        <div>
          <p className="kicker">04 — Contact</p>
          <h2 className="display contact__title">Envoyez-moi une minute de votre prise</h2>
          <p className="prose contact__prose">
            Une minute suffit pour savoir ce qui est faisable et à quel prix. Dites-moi
            aussi dans quelles conditions c’était enregistré — la pièce en dit souvent plus
            que le fichier.
          </p>

          <p className="contact__noform">
            <span className="notice__label">Pas de formulaire</span>
            <span>
              Un formulaire demanderait un serveur pour recevoir vos données. Ce site n’en
              a pas, et c’est justement l’argument. Un courriel, donc.
            </span>
          </p>

          <a className="button button--solid contact__mail" href={`mailto:${EMAIL}`}>
            {EMAIL}
          </a>
        </div>

        <aside className="plate contact__card">
          <div className="plate__head">
            <span className="kicker">À joindre</span>
          </div>
          <ul className="contact__list">
            <li>
              <span className="contact__listLabel">Un extrait</span>
              <span className="contact__listHint">
                30 s à 1 min, non traité, dans le format d’origine
              </span>
            </li>
            <li>
              <span className="contact__listLabel">Le contexte</span>
              <span className="contact__listHint">
                micro, pièce, ce qui vous gêne à l’écoute
              </span>
            </li>
            <li>
              <span className="contact__listLabel">La destination</span>
              <span className="contact__listHint">
                podcast, vidéo, diffusion, archive
              </span>
            </li>
            <li>
              <span className="contact__listLabel">Le volume</span>
              <span className="contact__listHint">une prise, ou une série qui revient</span>
            </li>
          </ul>
        </aside>
      </div>
    </section>
  );
}
