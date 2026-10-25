import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { takePersonalLinkFromLocation } from './lib/personalLink';
import { supabase } from './lib/supabase';
import { createSupabaseApi } from './services/loveGiftApi';
import './styles/global.css';

const api = supabase ? createSupabaseApi(supabase) : null;
// Read once, before rendering, and strip it from the address bar.
const personalLink = takePersonalLinkFromLocation();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App api={api} personalLink={personalLink} />
  </StrictMode>,
);
