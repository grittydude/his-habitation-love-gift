import { Heart } from 'lucide-react';

export function SiteFooter() {
  return (
    <footer className="footer">
      <span className="footer__heart" aria-hidden="true"><Heart size={14} fill="currentColor" /></span>
      <p>Made with love for <b>His Habitation</b></p>
      <p className="footer__motto">Love · Kindness · Fellowship</p>
    </footer>
  );
}
