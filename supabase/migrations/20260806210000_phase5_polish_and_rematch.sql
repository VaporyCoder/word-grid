alter table public.matches add column previous_match_id uuid unique references public.matches(id) on delete set null;

create table public.rematch_votes (
  match_id uuid not null references public.matches(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (match_id, player_id)
);

alter table public.rematch_votes enable row level security;
create policy "members read rematch votes" on public.rematch_votes for select to authenticated using (
  exists (select 1 from public.matches m where m.id = match_id and public.is_room_member(m.room_id))
);
revoke all on public.rematch_votes from anon, authenticated;
grant select on public.rematch_votes to authenticated;

create function public.create_match_for_room(target_room_id uuid, first_player_id uuid, prior_match_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_match_id uuid;
  participant record;
  shuffled_deck jsonb;
  next_card jsonb;
  first_discard jsonb;
  discard_index integer;
  round_index integer;
begin
  if not exists (select 1 from public.players where id = first_player_id and room_id = target_room_id and left_at is null) then
    raise exception 'INVALID_STARTING_PLAYER';
  end if;
  if (select count(*) from public.players where room_id = target_room_id and left_at is null) < 2 then
    raise exception 'NEED_TWO_PLAYERS';
  end if;
  insert into public.matches (room_id, phase, starting_player_id, previous_match_id)
  values (target_room_id, 'playing', first_player_id, prior_match_id) returning id into new_match_id;
  insert into public.match_participants (match_id, player_id, turn_position, hand_count, stats)
  select new_match_id, id, row_number() over (order by seat_number)::smallint, 0,
    '{"cardsPlayed":0,"cardsDrawn":0,"actionCardsUsed":0,"wildCardsUsed":0,"successfulCallouts":0}'::jsonb
  from public.players where room_id = target_room_id and left_at is null order by seat_number;
  insert into public.private_player_hands (participant_id, cards)
  select id, '[]'::jsonb from public.match_participants where match_id = new_match_id;
  select jsonb_agg(card order by gen_random_uuid()) into shuffled_deck
  from jsonb_array_elements(public.build_game_deck()) source(card);
  for round_index in 1..7 loop
    for participant in select id from public.match_participants where match_id = new_match_id order by turn_position loop
      next_card := shuffled_deck->0;
      shuffled_deck := shuffled_deck - 0;
      update public.private_player_hands set cards = cards || jsonb_build_array(next_card) where participant_id = participant.id;
    end loop;
  end loop;
  update public.match_participants set hand_count = 7 where match_id = new_match_id;
  select (ordinal - 1)::integer, card into discard_index, first_discard
  from jsonb_array_elements(shuffled_deck) with ordinality source(card, ordinal)
  where card->>'color' is not null and card->>'value' ~ '^[0-9]$' order by ordinal limit 1;
  if first_discard is null then raise exception 'DECK_SETUP_FAILED'; end if;
  shuffled_deck := shuffled_deck - discard_index;
  insert into public.match_internal_state (match_id, draw_pile, discard_pile)
  values (new_match_id, shuffled_deck, jsonb_build_array(first_discard));
  insert into public.public_match_state (match_id, current_player_id, direction, discard_top, active_color, draw_pile_count, turn_state)
  values (new_match_id, first_player_id, 1, first_discard, first_discard->>'color', jsonb_array_length(shuffled_deck),
    jsonb_build_object('drawnCardPending', false, 'pendingWildPlayerId', null, 'vulnerablePlayerId', null,
      'declaredPlayerId', null, 'winnerId', null, 'lastPenalty', null));
  insert into public.game_events (match_id, state_version, event_type, actor_player_id, public_payload)
  values (new_match_id, 0, 'game-started', first_player_id, jsonb_build_object('message', 'A new round began.'));
  return new_match_id;
end;
$$;

create or replace function public.start_room(room_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.rooms;
  caller_player_id uuid;
  player_count integer;
  first_player_id uuid;
  new_match_id uuid;
begin
  select * into target_room from public.rooms where code = upper(trim(room_code)) for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  select ps.player_id into caller_player_id from public.player_sessions ps join public.players p on p.id = ps.player_id
  where ps.auth_user_id = auth.uid() and p.room_id = target_room.id and p.left_at is null limit 1;
  if caller_player_id is distinct from target_room.host_player_id then raise exception 'HOST_ONLY'; end if;
  if target_room.status <> 'lobby' then raise exception 'ROOM_ALREADY_STARTED'; end if;
  select count(*) into player_count from public.players where room_id = target_room.id and left_at is null
    and connection_status = 'connected' and last_seen_at > now() - interval '75 seconds';
  if player_count < 2 then raise exception 'NEED_TWO_PLAYERS'; end if;
  select id into first_player_id from public.players where room_id = target_room.id and left_at is null order by seat_number limit 1;
  new_match_id := public.create_match_for_room(target_room.id, first_player_id, null);
  update public.rooms set status = 'active', state_version = state_version + 1 where id = target_room.id;
  return new_match_id;
end;
$$;

create function public.record_polish_stats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare card_value text;
begin
  if new.actor_player_id is null then return new; end if;
  if new.event_type = 'card-played' then
    card_value := new.public_payload->'card'->>'value';
    if card_value in ('skip', 'reverse', 'draw-two') then
      update public.match_participants set stats = jsonb_set(stats, '{actionCardsUsed}', to_jsonb(coalesce((stats->>'actionCardsUsed')::integer, 0) + 1), true)
      where match_id = new.match_id and player_id = new.actor_player_id;
    elsif card_value in ('wild', 'wild-draw-four') then
      update public.match_participants set stats = jsonb_set(stats, '{wildCardsUsed}', to_jsonb(coalesce((stats->>'wildCardsUsed')::integer, 0) + 1), true)
      where match_id = new.match_id and player_id = new.actor_player_id;
    end if;
  elsif new.event_type = 'player-called-out' then
    update public.match_participants set stats = jsonb_set(stats, '{successfulCallouts}', to_jsonb(coalesce((stats->>'successfulCallouts')::integer, 0) + 1), true)
    where match_id = new.match_id and player_id = new.actor_player_id;
  end if;
  return new;
end;
$$;

create trigger game_events_record_polish_stats
after insert on public.game_events
for each row execute function public.record_polish_stats();

create function public.get_rematch_status(target_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare target_match public.matches;
begin
  select * into target_match from public.matches where id = target_match_id;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;
  if not public.is_room_member(target_match.room_id) then raise exception 'NOT_ROOM_MEMBER'; end if;
  return jsonb_build_object(
    'votedPlayerIds', coalesce((select jsonb_agg(rv.player_id) from public.rematch_votes rv where rv.match_id = target_match_id), '[]'::jsonb),
    'requiredVotes', (select count(*) from public.match_participants mp join public.players p on p.id = mp.player_id where mp.match_id = target_match_id and p.left_at is null),
    'nextMatchId', (select id from public.matches where previous_match_id = target_match_id limit 1)
  );
end;
$$;

create function public.request_rematch(target_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_match public.matches;
  actor_player_id uuid;
  required_votes integer;
  vote_count integer;
  previous_seat smallint;
  next_start_player_id uuid;
  next_match_id uuid;
begin
  select * into target_match from public.matches where id = target_match_id for update;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;
  if target_match.phase <> 'won' then raise exception 'MATCH_NOT_FINISHED'; end if;
  perform 1 from public.rooms where id = target_match.room_id and status = 'active' for update;
  if not found then raise exception 'ROOM_NOT_ACTIVE'; end if;
  select mp.player_id into actor_player_id from public.match_participants mp
  join public.player_sessions ps on ps.player_id = mp.player_id
  where mp.match_id = target_match_id and ps.auth_user_id = auth.uid() and ps.expires_at > now() limit 1;
  if actor_player_id is null then raise exception 'NOT_MATCH_PARTICIPANT'; end if;
  select id into next_match_id from public.matches where previous_match_id = target_match_id limit 1;
  if next_match_id is not null then return jsonb_build_object('votes', 0, 'required', 0, 'matchId', next_match_id); end if;
  insert into public.rematch_votes (match_id, player_id) values (target_match_id, actor_player_id) on conflict do nothing;
  select count(*) into required_votes from public.match_participants mp join public.players p on p.id = mp.player_id
  where mp.match_id = target_match_id and p.left_at is null;
  select count(*) into vote_count from public.rematch_votes rv join public.players p on p.id = rv.player_id
  where rv.match_id = target_match_id and p.left_at is null;
  if vote_count >= required_votes and required_votes >= 2 then
    select p.seat_number into previous_seat from public.players p where p.id = target_match.starting_player_id;
    select p.id into next_start_player_id from public.players p
    where p.room_id = target_match.room_id and p.left_at is null
    order by case when p.seat_number > previous_seat then 0 else 1 end, p.seat_number limit 1;
    next_match_id := public.create_match_for_room(target_match.room_id, next_start_player_id, target_match_id);
  end if;
  return jsonb_build_object('votes', vote_count, 'required', required_votes, 'matchId', coalesce(next_match_id, target_match_id));
end;
$$;

create function public.return_room_to_lobby(room_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.rooms;
  caller_player_id uuid;
  latest_phase text;
begin
  select * into target_room from public.rooms where code = upper(trim(room_code)) for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  select ps.player_id into caller_player_id from public.player_sessions ps join public.players p on p.id = ps.player_id
  where ps.auth_user_id = auth.uid() and p.room_id = target_room.id and p.left_at is null and ps.expires_at > now() limit 1;
  if caller_player_id is distinct from target_room.host_player_id then raise exception 'HOST_ONLY'; end if;
  select phase into latest_phase from public.matches where room_id = target_room.id order by created_at desc limit 1;
  if latest_phase is distinct from 'won' then raise exception 'MATCH_NOT_FINISHED'; end if;
  update public.rooms set status = 'lobby', state_version = state_version + 1 where id = target_room.id;
end;
$$;

revoke all on function public.create_match_for_room(uuid, uuid, uuid) from public;
revoke all on function public.record_polish_stats() from public;
revoke all on function public.get_rematch_status(uuid) from public;
revoke all on function public.request_rematch(uuid) from public;
revoke all on function public.return_room_to_lobby(text) from public;
grant execute on function public.start_room(text) to authenticated;
grant execute on function public.get_rematch_status(uuid) to authenticated;
grant execute on function public.request_rematch(uuid) to authenticated;
grant execute on function public.return_room_to_lobby(text) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rematch_votes') then
    alter publication supabase_realtime add table public.rematch_votes;
  end if;
end $$;

comment on function public.request_rematch(uuid) is 'Records one vote per active participant and atomically creates the next match after unanimous consent.';
