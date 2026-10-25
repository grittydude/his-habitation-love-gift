import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { supabase } from './lib/supabase';
import { createSupabaseApi } from './services/loveGiftApi';
import './styles/global.css';

const api = supabase ? createSupabaseApi(supabase) : null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App api={api} />
  </StrictMode>,
);
