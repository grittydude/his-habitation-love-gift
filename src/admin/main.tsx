import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AdminApp from './AdminApp';
import { supabase } from '../lib/supabase';
import { createSupabaseAdminApi } from '../services/adminApi';
import { createSupabaseApi } from '../services/loveGiftApi';
import '../styles/global.css';

const api = supabase ? createSupabaseAdminApi(supabase) : null;
const progressFeed = supabase ? createSupabaseApi(supabase) : null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminApp api={api} progressFeed={progressFeed} />
  </StrictMode>,
);
