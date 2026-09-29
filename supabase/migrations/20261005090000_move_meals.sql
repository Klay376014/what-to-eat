-- Moving "other" meals (#40): a current member moves an "other" meal one
-- stop up or down its day's trail, past breakfast, lunch and dinner as well
-- as the day's other "other" meals. A morning coffee can sit between
-- breakfast and lunch, a dawn market before breakfast.
--
-- Breakfast, lunch and dinner sit at places 1, 2 and 3 of their day whether
-- or not anyone has added them (FIXED_PLACES in apps/web/src/grid/meal.ts),
-- so they carry no place of their own and never move. An "other" meal's
-- place is any number around those: 2.5 is between lunch and dinner. It is
-- numeric rather than float, and a midpoint is taken by multiplying by 0.5,
-- which numeric does exactly (dividing would round to 16 decimals), so
-- there is always room between two places. The app reads a place as a
-- double, which still tells apart some fifty moves into the same gap.
--
-- A new "other" meal goes after dinner and after every meal added before
-- it: 3 + its position, which only ever grows, so however the day has been
-- rearranged a new meal lands at its end. Existing ones get the same, which
-- is the order they already had.

alter table public.meals add column place numeric;

update public.meals set place = 3 + position where slot = 'other';

alter table public.meals
  add constraint meals_place_check check ((slot = 'other') = (place is not null));

-- Placing a new meal ---------------------------------------------------------
-- A BEFORE trigger, which sees the identity's position already drawn. The
-- column has no grant, so a client cannot send a place; this sets it anyway.
-- The trigger function needs no grant to fire.

create function private.place_new_meal()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.place := case when new.slot = 'other' then 3 + new.position end;
  return new;
end;
$$;

create trigger meals_place_new
  before insert on public.meals
  for each row execute function private.place_new_meal();

-- Moving a meal --------------------------------------------------------------

-- A day's stops as its trail lists them: breakfast, lunch and dinner at
-- their fixed places (meal null), and the day's "other" meals but one.
create function private.day_stops(trip_id uuid, day date, leaving_out uuid)
returns table (place numeric, meal uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  select fixed.place, null::uuid from (values (1::numeric), (2), (3)) as fixed (place)
  union all
  select m.place, m.id from public.meals m
  where m.trip_id = day_stops.trip_id
    and m.date = day_stops.day
    and m.slot = 'other'
    and m.id <> day_stops.leaving_out;
$$;

-- Moves the meal past the next stop that way. Past another "other" meal the
-- two swap places; past breakfast, lunch or dinner it goes halfway to the
-- stop beyond, so it sits right the other side. Returns each meal whose
-- place changed. Refuses with 'meal_not_movable' for breakfast, lunch and
-- dinner and 'meal_at_end' at either end of the day.
--
-- Two members moving meals of one day at once take turns: each first locks
-- the day's "other" meals, in id order so two moves cannot deadlock, and
-- reads the places only once it holds them. FOR NO KEY UPDATE, like
-- nudge_meal, so a move does not block proposals or votes on the meals.
--
-- SECURITY DEFINER: members hold no update grant on place, so this is the
-- only way a place changes, one stop at a time.
create function public.move_meal(meal_id uuid, direction text)
returns table (id uuid, place numeric)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  step integer;
  trip uuid;
  day date;
  slot public.meal_slot;
  here numeric;
  next_place numeric;
  next_meal uuid;
  beyond numeric;
begin
  if direction = 'up' then
    step := -1;
  elsif direction = 'down' then
    step := 1;
  else
    raise exception 'direction must be up or down' using errcode = '22023';
  end if;

  select m.trip_id, m.date, m.slot into trip, day, slot
  from public.meals m
  where m.id = move_meal.meal_id
    and m.trip_id in (select private.my_trip_ids());
  if trip is null then
    raise exception 'only current members of the trip can move its meals' using errcode = '42501';
  end if;
  if slot <> 'other' then
    raise exception 'meal_not_movable' using errcode = 'P0001';
  end if;

  perform 1 from public.meals m
  where m.trip_id = trip and m.date = day and m.slot = 'other'
  order by m.id
  for no key update;

  select m.place into here from public.meals m where m.id = move_meal.meal_id;

  select s.place, s.meal into next_place, next_meal
  from private.day_stops(trip, day, move_meal.meal_id) s
  where s.place * step > here * step
  order by s.place * step
  limit 1;
  if next_place is null then
    raise exception 'meal_at_end' using errcode = 'P0001';
  end if;

  if next_meal is not null then
    update public.meals m set place = here where m.id = next_meal;
    update public.meals m set place = next_place where m.id = move_meal.meal_id;
    return query values (move_meal.meal_id, next_place), (next_meal, here);
    return;
  end if;

  select s.place into beyond
  from private.day_stops(trip, day, move_meal.meal_id) s
  where s.place * step > next_place * step
  order by s.place * step
  limit 1;
  -- Nothing beyond: past breakfast to 0.5, or past dinner to 3.5.
  beyond := coalesce(beyond, next_place + step);

  update public.meals m set place = (next_place + beyond) * 0.5 where m.id = move_meal.meal_id;
  return query values (move_meal.meal_id, (next_place + beyond) * 0.5);
end;
$$;

-- Grants ---------------------------------------------------------------------------------------

revoke all on function private.place_new_meal() from public, anon, authenticated, service_role;
revoke all on function private.day_stops(uuid, date, uuid) from public, anon, authenticated, service_role;

revoke all on function public.move_meal(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.move_meal(uuid, text) to authenticated;
