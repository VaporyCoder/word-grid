create extension if not exists pgcrypto;

create type public.room_visibility as enum ('private', 'invite-only');
create type public.room_status as enum ('lobby', 'active', 'closed', 'expired');
create type public.player_connection_status as enum ('connected', 'reconnecting', 'disconnected', 'left');

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-HJ-KM-NP-Z2-9]{6}$'),
  visibility public.room_visibility not null default 'private',
  status public.room_status not null default 'lobby',
  host_player_id uuid,
  max_players smallint not null default 2 check (max_players between 2 and 4),
  state_version bigint not null default 0 check (state_version >= 0),
  expires_at timestamptz not null default (now() + interval '12 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.room_settings (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  turn_timer_enabled boolean not null default false,
  turn_timer_seconds smallint not null default 30 check (turn_timer_seconds between 10 and 180),
  draw_stacking boolean not null default false,
  draw_until_playable boolean not null default false,
  score_limit integer check (score_limit is null or score_limit > 0),
  rounds smallint not null default 1 check (rounds between 1 and 20),
  last_card_phrase text not null default 'Last Card!' check (char_length(last_card_phrase) between 1 and 32),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 24),
  seat_number smallint not null check (seat_number between 1 and 4),
  connection_status public.player_connection_status not null default 'connected',
  last_seen_at timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  left_at timestamptz
);

alter table public.rooms
  add constraint rooms_host_player_fk foreign key (host_player_id) references public.players(id) on delete set null;

create table public.player_sessions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null unique references public.players(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '12 hours'),
  last_resumed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (auth_user_id, room_id)
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_number smallint not null default 1 check (round_number > 0),
  phase text not null default 'playing' check (phase in ('playing', 'won', 'abandoned')),
  starting_player_id uuid references public.players(id),
  winner_player_id uuid references public.players(id),
  state_version bigint not null default 0 check (state_version >= 0),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.match_participants (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  turn_position smallint not null check (turn_position between 1 and 4),
  hand_count smallint not null default 0 check (hand_count >= 0),
  score integer not null default 0,
  stats jsonb not null default '{}'::jsonb check (jsonb_typeof(stats) = 'object'),
  unique (match_id, player_id),
  unique (match_id, turn_position)
);

create table public.public_match_state (
  match_id uuid primary key references public.matches(id) on delete cascade,
  current_player_id uuid references public.players(id),
  direction smallint not null default 1 check (direction in (-1, 1)),
  discard_top jsonb not null default '{}'::jsonb check (jsonb_typeof(discard_top) = 'object'),
  active_color text check (active_color in ('crimson', 'gold', 'emerald', 'azure')),
  draw_pile_count smallint not null default 0 check (draw_pile_count >= 0),
  turn_state jsonb not null default '{}'::jsonb check (jsonb_typeof(turn_state) = 'object'),
  updated_at timestamptz not null default now()
);

create table public.private_player_hands (
  participant_id uuid primary key references public.match_participants(id) on delete cascade,
  cards jsonb not null default '[]'::jsonb check (jsonb_typeof(cards) = 'array'),
  updated_at timestamptz not null default now()
);

create table public.game_events (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.matches(id) on delete cascade,
  state_version bigint not null check (state_version >= 0),
  event_type text not null,
  actor_player_id uuid references public.players(id),
  public_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(public_payload) = 'object'),
  created_at timestamptz not null default now(),
  unique (match_id, state_version, event_type)
);

create table public.game_actions (
  id uuid primary key,
  match_id uuid not null references public.matches(id) on delete cascade,
  actor_player_id uuid not null references public.players(id),
  expected_version bigint not null check (expected_version >= 0),
  action_type text not null,
  action_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(action_payload) = 'object'),
  accepted boolean,
  rejection_reason text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (match_id, id)
);

create index rooms_code_status_idx on public.rooms (code, status);
create index rooms_expires_at_idx on public.rooms (expires_at);
create unique index players_room_active_seat_unique on public.players (room_id, seat_number) where left_at is null;
create index players_last_seen_idx on public.players (last_seen_at) where left_at is null;
create index player_sessions_auth_idx on public.player_sessions (auth_user_id, expires_at);
create index matches_room_idx on public.matches (room_id, created_at desc);
create index game_events_match_idx on public.game_events (match_id, id desc);
create index game_actions_match_version_idx on public.game_actions (match_id, expected_version);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger rooms_set_updated_at before update on public.rooms for each row execute function public.set_updated_at();
create trigger room_settings_set_updated_at before update on public.room_settings for each row execute function public.set_updated_at();
create trigger matches_set_updated_at before update on public.matches for each row execute function public.set_updated_at();
create trigger public_match_state_set_updated_at before update on public.public_match_state for each row execute function public.set_updated_at();
create trigger private_hands_set_updated_at before update on public.private_player_hands for each row execute function public.set_updated_at();

create function public.is_room_member(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.players p
    join public.player_sessions ps on ps.player_id = p.id
    where p.room_id = target_room_id
      and ps.auth_user_id = auth.uid()
      and ps.expires_at > now()
      and p.left_at is null
  );
$$;

create function public.room_id_from_topic(topic_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(topic_name, ':', 1) = 'room'
      and split_part(topic_name, ':', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then split_part(topic_name, ':', 2)::uuid
    else null
  end;
$$;

create function public.generate_room_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  result text := '';
  i integer;
begin
  for i in 1..6 loop
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1);
  end loop;
  return result;
end;
$$;

create function public.create_room(
  player_name text,
  room_visibility public.room_visibility default 'private',
  player_limit smallint default 2,
  final_card_phrase text default 'Last Card!'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_id uuid := auth.uid();
  new_room public.rooms;
  new_player public.players;
  candidate_code text;
  attempt integer;
begin
  if user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if char_length(trim(player_name)) not between 1 and 24 then raise exception 'INVALID_DISPLAY_NAME'; end if;
  if player_limit not between 2 and 4 then raise exception 'INVALID_PLAYER_LIMIT'; end if;
  if char_length(trim(final_card_phrase)) not between 1 and 32 then raise exception 'INVALID_LAST_CARD_PHRASE'; end if;

  for attempt in 1..12 loop
    candidate_code := public.generate_room_code();
    begin
      insert into public.rooms (code, visibility, max_players)
      values (candidate_code, room_visibility, player_limit)
      returning * into new_room;
      exit;
    exception when unique_violation then
      if attempt = 12 then raise exception 'ROOM_CODE_EXHAUSTED'; end if;
    end;
  end loop;

  insert into public.players (room_id, display_name, seat_number)
  values (new_room.id, trim(player_name), 1)
  returning * into new_player;

  insert into public.player_sessions (player_id, room_id, auth_user_id, expires_at)
  values (new_player.id, new_room.id, user_id, new_room.expires_at);

  insert into public.room_settings (room_id, last_card_phrase)
  values (new_room.id, trim(final_card_phrase));

  update public.rooms set host_player_id = new_player.id where id = new_room.id;

  return jsonb_build_object('roomId', new_room.id, 'roomCode', new_room.code, 'playerId', new_player.id);
end;
$$;

create function public.join_room(room_code text, player_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_id uuid := auth.uid();
  target_room public.rooms;
  joined_player public.players;
  next_seat smallint;
  active_count integer;
begin
  if user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if char_length(trim(player_name)) not between 1 and 24 then raise exception 'INVALID_DISPLAY_NAME'; end if;

  select * into target_room from public.rooms where code = upper(trim(room_code)) for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if target_room.expires_at <= now() or target_room.status = 'expired' then raise exception 'ROOM_EXPIRED'; end if;

  select p.* into joined_player
  from public.players p
  join public.player_sessions ps on ps.player_id = p.id
  where p.room_id = target_room.id and ps.auth_user_id = user_id and p.left_at is null
  limit 1;

  if found then
    update public.players set display_name = trim(player_name), connection_status = 'connected', last_seen_at = now(), left_at = null
    where id = joined_player.id returning * into joined_player;
    update public.player_sessions set last_resumed_at = now(), expires_at = target_room.expires_at where player_id = joined_player.id;
    return jsonb_build_object('roomId', target_room.id, 'roomCode', target_room.code, 'playerId', joined_player.id);
  end if;

  if target_room.status <> 'lobby' then raise exception 'ROOM_ALREADY_STARTED'; end if;
  select count(*) into active_count from public.players where room_id = target_room.id and left_at is null;
  if active_count >= target_room.max_players then raise exception 'ROOM_FULL'; end if;

  select seat::smallint into next_seat
  from generate_series(1, target_room.max_players) seat
  where not exists (select 1 from public.players p where p.room_id = target_room.id and p.seat_number = seat and p.left_at is null)
  order by seat limit 1;

  insert into public.players (room_id, display_name, seat_number)
  values (target_room.id, trim(player_name), next_seat)
  returning * into joined_player;

  insert into public.player_sessions (player_id, room_id, auth_user_id, expires_at)
  values (joined_player.id, target_room.id, user_id, target_room.expires_at);

  update public.rooms set state_version = state_version + 1 where id = target_room.id;
  return jsonb_build_object('roomId', target_room.id, 'roomCode', target_room.code, 'playerId', joined_player.id);
end;
$$;

create function public.get_room_lobby(room_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.rooms;
  current_player_id uuid;
  result jsonb;
begin
  select * into target_room from public.rooms where code = upper(trim(room_code));
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if not public.is_room_member(target_room.id) then raise exception 'NOT_ROOM_MEMBER'; end if;

  select ps.player_id into current_player_id
  from public.player_sessions ps
  join public.players p on p.id = ps.player_id
  where ps.auth_user_id = auth.uid() and p.room_id = target_room.id and p.left_at is null
  limit 1;

  select jsonb_build_object(
    'room', jsonb_build_object(
      'id', target_room.id, 'code', target_room.code, 'status', target_room.status,
      'visibility', target_room.visibility, 'hostPlayerId', target_room.host_player_id,
      'maxPlayers', target_room.max_players, 'stateVersion', target_room.state_version,
      'expiresAt', target_room.expires_at
    ),
    'settings', jsonb_build_object(
      'turnTimerEnabled', rs.turn_timer_enabled, 'turnTimerSeconds', rs.turn_timer_seconds,
      'drawStacking', rs.draw_stacking, 'drawUntilPlayable', rs.draw_until_playable,
      'scoreLimit', rs.score_limit, 'rounds', rs.rounds, 'lastCardPhrase', rs.last_card_phrase
    ),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'displayName', p.display_name, 'seatNumber', p.seat_number,
        'connectionStatus', p.connection_status, 'lastSeenAt', p.last_seen_at,
        'isHost', p.id = target_room.host_player_id
      ) order by p.seat_number)
      from public.players p where p.room_id = target_room.id and p.left_at is null
    ), '[]'::jsonb),
    'currentPlayerId', current_player_id
  ) into result
  from public.room_settings rs where rs.room_id = target_room.id;

  return result;
end;
$$;

create function public.touch_room_presence(room_code text, next_status public.player_connection_status default 'connected')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if next_status = 'left' then raise exception 'USE_LEAVE_ROOM'; end if;
  update public.players p
  set connection_status = next_status, last_seen_at = now()
  from public.player_sessions ps, public.rooms r
  where ps.player_id = p.id and ps.auth_user_id = auth.uid()
    and r.id = p.room_id and r.code = upper(trim(room_code)) and p.left_at is null;
  if not found then raise exception 'NOT_ROOM_MEMBER'; end if;
end;
$$;

create function public.leave_room(room_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.rooms;
  leaving_player_id uuid;
  replacement_host_id uuid;
begin
  select * into target_room from public.rooms where code = upper(trim(room_code)) for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  select ps.player_id into leaving_player_id
  from public.player_sessions ps join public.players p on p.id = ps.player_id
  where ps.auth_user_id = auth.uid() and p.room_id = target_room.id and p.left_at is null limit 1;
  if leaving_player_id is null then raise exception 'NOT_ROOM_MEMBER'; end if;

  update public.players set connection_status = 'left', left_at = now(), last_seen_at = now() where id = leaving_player_id;
  delete from public.player_sessions where player_id = leaving_player_id and auth_user_id = auth.uid();
  if target_room.host_player_id = leaving_player_id then
    select id into replacement_host_id from public.players
    where room_id = target_room.id and left_at is null order by seat_number limit 1;
    update public.rooms set host_player_id = replacement_host_id,
      status = case when replacement_host_id is null then 'closed'::public.room_status else status end,
      state_version = state_version + 1
    where id = target_room.id;
  else
    update public.rooms set state_version = state_version + 1 where id = target_room.id;
  end if;
end;
$$;

create function public.start_room(room_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.rooms;
  caller_player_id uuid;
  player_count integer;
begin
  select * into target_room from public.rooms where code = upper(trim(room_code)) for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  select ps.player_id into caller_player_id
  from public.player_sessions ps join public.players p on p.id = ps.player_id
  where ps.auth_user_id = auth.uid() and p.room_id = target_room.id and p.left_at is null limit 1;
  if caller_player_id is distinct from target_room.host_player_id then raise exception 'HOST_ONLY'; end if;
  if target_room.status <> 'lobby' then raise exception 'ROOM_ALREADY_STARTED'; end if;
  select count(*) into player_count from public.players
  where room_id = target_room.id and left_at is null
    and connection_status = 'connected' and last_seen_at > now() - interval '75 seconds';
  if player_count < 2 then raise exception 'NEED_TWO_PLAYERS'; end if;
  update public.rooms set status = 'active', state_version = state_version + 1 where id = target_room.id;
end;
$$;

create function public.cleanup_abandoned_rooms()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare affected integer;
begin
  update public.players set connection_status = 'disconnected'
  where left_at is null and connection_status <> 'disconnected' and last_seen_at < now() - interval '90 seconds';
  update public.rooms set status = 'expired'
  where status in ('lobby', 'active') and expires_at <= now();
  delete from public.rooms where status in ('closed', 'expired') and updated_at < now() - interval '24 hours';
  get diagnostics affected = row_count;
  return affected;
end;
$$;

alter table public.rooms enable row level security;
alter table public.room_settings enable row level security;
alter table public.players enable row level security;
alter table public.player_sessions enable row level security;
alter table public.matches enable row level security;
alter table public.match_participants enable row level security;
alter table public.public_match_state enable row level security;
alter table public.private_player_hands enable row level security;
alter table public.game_events enable row level security;
alter table public.game_actions enable row level security;

create policy "members read rooms" on public.rooms for select to authenticated using (public.is_room_member(id));
create policy "members read room settings" on public.room_settings for select to authenticated using (public.is_room_member(room_id));
create policy "members read public players" on public.players for select to authenticated using (public.is_room_member(room_id));
create policy "owners read their session" on public.player_sessions for select to authenticated using (auth_user_id = auth.uid());
create policy "members read matches" on public.matches for select to authenticated using (public.is_room_member(room_id));
create policy "members read participants" on public.match_participants for select to authenticated using (
  exists (select 1 from public.matches m where m.id = match_id and public.is_room_member(m.room_id))
);
create policy "members read public match state" on public.public_match_state for select to authenticated using (
  exists (select 1 from public.matches m where m.id = match_id and public.is_room_member(m.room_id))
);
create policy "players read only their own hand" on public.private_player_hands for select to authenticated using (
  exists (
    select 1 from public.match_participants mp
    join public.player_sessions ps on ps.player_id = mp.player_id
    where mp.id = participant_id and ps.auth_user_id = auth.uid() and ps.expires_at > now()
  )
);
create policy "members read public events" on public.game_events for select to authenticated using (
  exists (select 1 from public.matches m where m.id = match_id and public.is_room_member(m.room_id))
);

create policy "room members receive realtime" on realtime.messages for select to authenticated using (
  realtime.messages.extension in ('broadcast', 'presence')
  and public.is_room_member(public.room_id_from_topic((select realtime.topic())))
);
create policy "room members send realtime" on realtime.messages for insert to authenticated with check (
  realtime.messages.extension in ('broadcast', 'presence')
  and public.is_room_member(public.room_id_from_topic((select realtime.topic())))
);

revoke all on public.rooms, public.room_settings, public.players, public.player_sessions,
  public.matches, public.match_participants, public.public_match_state, public.private_player_hands,
  public.game_events, public.game_actions from anon, authenticated;
grant select on public.rooms, public.room_settings, public.players, public.player_sessions,
  public.matches, public.match_participants, public.public_match_state, public.private_player_hands, public.game_events
  to authenticated;
grant usage on schema public to authenticated;
grant usage on type public.room_visibility, public.player_connection_status to authenticated;

revoke all on function public.create_room(text, public.room_visibility, smallint, text) from public;
revoke all on function public.join_room(text, text) from public;
revoke all on function public.get_room_lobby(text) from public;
revoke all on function public.touch_room_presence(text, public.player_connection_status) from public;
revoke all on function public.leave_room(text) from public;
revoke all on function public.start_room(text) from public;
revoke all on function public.generate_room_code() from public;
revoke all on function public.cleanup_abandoned_rooms() from public;
revoke all on function public.set_updated_at() from public;
grant execute on function public.create_room(text, public.room_visibility, smallint, text) to authenticated;
grant execute on function public.join_room(text, text) to authenticated;
grant execute on function public.get_room_lobby(text) to authenticated;
grant execute on function public.touch_room_presence(text, public.player_connection_status) to authenticated;
grant execute on function public.leave_room(text) to authenticated;
grant execute on function public.start_room(text) to authenticated;
grant execute on function public.cleanup_abandoned_rooms() to service_role;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rooms') then
    alter publication supabase_realtime add table public.rooms;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'players') then
    alter publication supabase_realtime add table public.players;
  end if;
end $$;

comment on table public.player_sessions is 'Maps an authenticated anonymous Supabase user to one public player record; never exposed to other players.';
comment on table public.private_player_hands is 'Private hand payloads. RLS permits reads only by the participant owner.';
comment on function public.cleanup_abandoned_rooms() is 'Run periodically with Supabase Cron; marks stale presence, expires rooms, and removes rooms after a recovery window.';
