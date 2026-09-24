-- Renaming meals: a current member may edit an "other" meal's label.
--
-- Only the label is granted, so a meal's day, slot, trip and order stay as
-- they were written. The label rules from 20260925110000_meals.sql hold on
-- update as they do on insert: the CHECKs refuse a blank, padded or
-- over-long name, a missing name on an "other" meal, and any name on
-- breakfast, lunch or dinner. The client sends the name trimmed.
--
-- The date-range trigger fires only on `update of date, trip_id`, so a meal
-- left outside its trip's dates by a later date change can still be renamed.
--
-- A departed member or a stranger matches no row, so their rename changes
-- nothing and raises nothing, whatever name they send: no row is ever
-- checked against the label rules on their behalf. (Postgres applies the
-- meals_select policy to an UPDATE's rows as well as this USING clause, so
-- each alone keeps them out; the policy states the rule rather than leaning
-- on that.)

create policy meals_update on public.meals
  for update to authenticated
  using (trip_id in (select private.my_trip_ids()))
  with check (trip_id in (select private.my_trip_ids()));

grant update (label) on public.meals to authenticated;
