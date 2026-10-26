-- His Habitation · Love Gift Day — choir roster (30 members → 15 pairs)
-- Idempotent: re-running inserts only names that are missing. It never
-- duplicates, renames, or deletes members, and never touches pairings.
-- Members are referenced everywhere by their generated uuid, not by name.
-- (Replaced on 2026-10-26: the live roster was swapped wholesale for this list.)
insert into public.members (display_name) values
  ('Ikechukwu Achom'),
  ('Bassey Edoho'),
  ('Emmanuel Frank'),
  ('Imaobong Tommy'),
  ('Uyime HOTR'),
  ('Abia Sunday'),
  ('Akpan Mkpouto'),
  ('Asuquo Great'),
  ('Hilda Joseph'),
  ('Miracle Nsima'),
  ('Faith Musa'),
  ('Fortune Promise'),
  ('Gladys Nyanor'),
  ('Hope Akpan'),
  ('Ime Okon'),
  ('Kenneth Osaru'),
  ('Inyang, Mkpongke-obong'),
  ('Mrs Patience'),
  ('Mrs Ruth'),
  ('Nsisong Udofia'),
  ('Samuel Mbang'),
  ('Uche Kingston'),
  ('Victoria Abas'),
  ('Victory Ogarekpe'),
  ('Benjamin Udom'),
  ('Utibe Meshach'),
  ('Mrs Victoria Itoro Umoh'),
  ('Precious'),
  ('Godwin Edoho'),
  ('Victor Emmanuel')
on conflict (display_name) do nothing;
