const STEPS = [
  { title: 'Sign in with your code', body: 'Pick your name and enter the personal access code the organiser sent you.' },
  { title: 'One draw, saved instantly', body: 'Your partner is chosen at random on the server and saved for both of you straight away.' },
  { title: 'Already chosen?', body: 'If someone drew your name first, signing in simply shows you who — no second draw.' },
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
