const HEARTS = [
  { left: '6%', size: 14, delay: 0, duration: 15 },
  { left: '16%', size: 22, delay: 4, duration: 19 },
  { left: '29%', size: 11, delay: 9, duration: 14 },
  { left: '44%', size: 17, delay: 2, duration: 21 },
  { left: '58%', size: 12, delay: 7, duration: 16 },
  { left: '71%', size: 24, delay: 11, duration: 22 },
  { left: '83%', size: 13, delay: 5, duration: 17 },
  { left: '93%', size: 18, delay: 13, duration: 20 },
];

/** Decorative drifting hearts for the hero. Hidden from assistive tech; frozen under reduced motion. */
export function HeartField() {
  return (
    <div className="heart-field" aria-hidden="true">
      {HEARTS.map((h, i) => (
        <svg
          key={i}
          className="heart-field__heart"
          viewBox="0 0 24 24"
          width={h.size}
          height={h.size}
          style={{ left: h.left, animationDelay: `-${h.delay}s`, animationDuration: `${h.duration}s` }}
        >
          <path d="M12 21s-7.5-4.6-10-9.3C.4 8.5 2.3 4.5 6.1 4.1c2.2-.2 3.9 1 5.9 3.1 2-2.1 3.7-3.3 5.9-3.1 3.8.4 5.7 4.4 4.1 7.6C19.5 16.4 12 21 12 21z" />
        </svg>
      ))}
    </div>
  );
}
