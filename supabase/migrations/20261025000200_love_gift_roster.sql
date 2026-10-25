-- His Habitation · Love Gift Day — choir roster (24 members)
-- Idempotent: re-running inserts only names that are missing. It never
-- duplicates, renames, or deletes members, and never touches pairings.
-- Members are referenced everywhere by their generated uuid, not by name.
insert into public.members (display_name) values
  ('Ikechukwu Achom'),
  ('Bassey HOTR'),
  ('Emmanuel Frank HOTR'),
  ('Miss Imaobong HOTR'),
  ('Uyime HOTR'),
  ('Abia'),
  ('Akpan Mkpouto'),
  ('Asuquo Mtn'),
  ('Buddy'),
  ('Choir Tailor'),
  ('Faith Muss'),
  ('Fortune HOTR'),
  ('Gladys HOTR'),
  ('Hope Bass'),
  ('Ime Okon'),
  ('Kenneth Drummer 2'),
  ('Mkpongke Main'),
  ('Mrs Patience HOTR'),
  ('Mrs Ruth HOTR'),
  ('Nsisong Bro Udofia HOTR'),
  ('Samuel A'),
  ('Uche His Habitation'),
  ('Victoria His Habitation'),
  ('Victory HOTR')
on conflict (display_name) do nothing;
