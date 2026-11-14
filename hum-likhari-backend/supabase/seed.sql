-- Safe, repeatable taxonomy seed. No demo users or posts are created here.
insert into public.content_categories (slug, label_ur, sort_order) values
  ('poetry', 'شاعری', 1),
  ('fiction', 'افسانہ', 2),
  ('column', 'کالم', 3),
  ('essay', 'مضمون', 4),
  ('travelogue', 'سفرنامہ', 5)
on conflict (slug) do update set label_ur = excluded.label_ur, sort_order = excluded.sort_order;

insert into public.content_topics (slug, label_ur, sort_order) values
  ('literature', 'ادب', 1),
  ('love', 'محبت', 2),
  ('society', 'سماج', 3),
  ('life', 'زندگی', 4),
  ('travel', 'سفر', 5),
  ('technology', 'ٹیکنالوجی', 6)
on conflict (slug) do update set label_ur = excluded.label_ur, sort_order = excluded.sort_order;
