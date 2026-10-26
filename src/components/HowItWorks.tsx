const STEPS = [
  { title: 'Open your personal link', body: 'Tap the link the organiser sent you privately — no password to remember.' },
  { title: 'Choose your partner', body: 'Press the button and your Love Gift partner is picked at random and saved straight away.' },
  { title: 'Keep it a surprise', body: 'Pray for them, prepare something thoughtful, and keep their name to yourself until Love Gift Day.' },
];

export function HowItWorks() {
  return (
    <section className="how container" aria-labelledby="how-heading">
      <p className="eyebrow">Simple · fair · private</p>
      <h2 id="how-heading" className="section-title">How it works</h2>
      <ol className="how__steps">
        {STEPS.map((s, i) => (
          <li key={s.title} className="how__step">
            <span className="how__num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
