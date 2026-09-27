create table public.match_internal_state (
  match_id uuid primary key references public.matches(id) on delete cascade,
  draw_pile jsonb not null check (jsonb_typeof(draw_pile) = 'array'),
  discard_pile jsonb not null check (jsonb_typeof(discard_pile) = 'array' and jsonb_array_length(discard_pile) > 0),
  drawn_card_id text,
  pending_wild jsonb check (pending_wild is null or jsonb_typeof(pending_wild) = 'object'),
  vulnerable_player_id uuid references public.players(id),
  declared_player_id uuid references public.players(id),
  updated_at timestamptz not null default now()
);

alter table public.match_internal_state enable row level security;
revoke all on public.match_internal_state from anon, authenticated;
revoke select on public.game_actions from authenticated;

create trigger match_internal_state_set_updated_at
before update on public.match_internal_state
for each row execute function public.set_updated_at();

create function public.build_game_deck()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with colors(color) as (
    values ('crimson'), ('gold'), ('emerald'), ('azure')
  ), numbered as (
    select color, value::text, copy
    from colors cross join generate_series(0, 9) value
    cross join lateral generate_series(1, case when value = 0 then 1 else 2 end) copy
  ), actions as (
    select color, value, copy
    from colors cross join (values ('skip'), ('reverse'), ('draw-two')) action(value)
    cross join generate_series(1, 2) copy
  ), wilds as (
    select null::text as color, value, copy
    from (values ('wild'), ('wild-draw-four')) wild(value)
    cross join generate_series(1, 4) copy
  ), cards as (
    select jsonb_build_object('id', color || '-' || value || '-' || copy, 'color', color, 'value', value) card from numbered
    union all
    select jsonb_build_object('id', color || '-' || value || '-' || copy, 'color', color, 'value', value) from actions
    union all
    select jsonb_build_object('id', value || '-' || copy, 'color', color, 'value', value) from wilds
  )
  select jsonb_agg(card) from cards;
$$;

create function public.card_is_playable(candidate jsonb, discard_top jsonb, active_color text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select candidate->>'value' in ('wild', 'wild-draw-four')
    or candidate->>'color' = active_color
    or candidate->>'value' = discard_top->>'value';
$$;

create function public.match_next_player(target_match_id uuid, from_player_id uuid, turn_direction smallint, step_count integer)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_position integer;
  participant_count integer;
  target_position integer;
  result uuid;
begin
  select turn_position into current_position
  from public.match_participants where match_id = target_match_id and player_id = from_player_id;
  select count(*) into participant_count from public.match_participants where match_id = target_match_id;
  if current_position is null or participant_count < 2 then raise exception 'INVALID_TURN_ORDER'; end if;
  target_position := (((current_position - 1 + turn_direction * step_count) % participant_count) + participant_count) % participant_count + 1;
  select player_id into result from public.match_participants
  where match_id = target_match_id and turn_position = target_position;
  return result;
end;
$$;

create function public.match_draw_cards(target_match_id uuid, target_player_id uuid, card_count integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  internal public.match_internal_state;
  hand jsonb;
  drawn jsonb := '[]'::jsonb;
  next_card jsonb;
  discard_top jsonb;
  recycled jsonb;
  index integer;
begin
  if card_count < 1 or card_count > 16 then raise exception 'INVALID_DRAW_COUNT'; end if;
  select * into internal from public.match_internal_state where match_id = target_match_id for update;
  select cards into hand from public.private_player_hands pph
  join public.match_participants mp on mp.id = pph.participant_id
  where mp.match_id = target_match_id and mp.player_id = target_player_id for update of pph;
  if hand is null then raise exception 'PRIVATE_HAND_NOT_FOUND'; end if;

  for index in 1..card_count loop
    if jsonb_array_length(internal.draw_pile) = 0 then
      if jsonb_array_length(internal.discard_pile) <= 1 then exit; end if;
      discard_top := internal.discard_pile->(jsonb_array_length(internal.discard_pile) - 1);
      select coalesce(jsonb_agg(card order by gen_random_uuid()), '[]'::jsonb) into recycled
      from jsonb_array_elements(internal.discard_pile) with ordinality source(card, ordinal)
      where ordinal < jsonb_array_length(internal.discard_pile);
      internal.draw_pile := recycled;
      internal.discard_pile := jsonb_build_array(discard_top);
    end if;
    next_card := internal.draw_pile->0;
    if next_card is null then exit; end if;
    internal.draw_pile := internal.draw_pile - 0;
    hand := hand || jsonb_build_array(next_card);
    drawn := drawn || jsonb_build_array(next_card);
  end loop;

  update public.match_internal_state set draw_pile = internal.draw_pile, discard_pile = internal.discard_pile
  where match_id = target_match_id;
  update public.private_player_hands set cards = hand
  where participant_id = (select id from public.match_participants where match_id = target_match_id and player_id = target_player_id);
  update public.match_participants set hand_count = jsonb_array_length(hand),
    stats = jsonb_set(stats, '{cardsDrawn}', to_jsonb(coalesce((stats->>'cardsDrawn')::integer, 0) + jsonb_array_length(drawn)), true)
  where match_id = target_match_id and player_id = target_player_id;
  return drawn;
end;
$$;

drop function public.start_room(text);

create function public.start_room(room_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.rooms;
  caller_player_id uuid;
  player_count integer;
  new_match_id uuid;
  first_player_id uuid;
  participant record;
  shuffled_deck jsonb;
  hand jsonb;
  next_card jsonb;
  first_discard jsonb;
  discard_index integer;
  round_index integer;
begin
  select * into target_room from public.rooms where code = upper(trim(room_code)) for update;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  select ps.player_id into caller_player_id
  from public.player_sessions ps join public.players p on p.id = ps.player_id
  where ps.auth_user_id = auth.uid() and p.room_id = target_room.id and p.left_at is null limit 1;
  if caller_player_id is distinct from target_room.host_player_id then raise exception 'HOST_ONLY'; end if;
  if target_room.status <> 'lobby' then raise exception 'ROOM_ALREADY_STARTED'; end if;
  select count(*) into player_count from public.players
  where room_id = target_room.id and left_at is null and connection_status = 'connected'
    and last_seen_at > now() - interval '75 seconds';
  if player_count < 2 then raise exception 'NEED_TWO_PLAYERS'; end if;

  select id into first_player_id from public.players
  where room_id = target_room.id and left_at is null order by seat_number limit 1;
  insert into public.matches (room_id, phase, starting_player_id)
  values (target_room.id, 'playing', first_player_id) returning id into new_match_id;

  insert into public.match_participants (match_id, player_id, turn_position, hand_count, stats)
  select new_match_id, id, row_number() over (order by seat_number), 0,
    '{"cardsPlayed":0,"cardsDrawn":0,"actionCardsUsed":0,"wildCardsUsed":0,"successfulCallouts":0}'::jsonb
  from public.players where room_id = target_room.id and left_at is null order by seat_number;

  insert into public.private_player_hands (participant_id, cards)
  select id, '[]'::jsonb from public.match_participants where match_id = new_match_id;

  select jsonb_agg(card order by gen_random_uuid()) into shuffled_deck
  from jsonb_array_elements(public.build_game_deck()) source(card);

  for round_index in 1..7 loop
    for participant in select id from public.match_participants where match_id = new_match_id order by turn_position loop
      next_card := shuffled_deck->0;
      shuffled_deck := shuffled_deck - 0;
      update public.private_player_hands set cards = cards || jsonb_build_array(next_card)
      where participant_id = participant.id;
    end loop;
  end loop;
  update public.match_participants set hand_count = 7 where match_id = new_match_id;

  select (ordinal - 1)::integer, card into discard_index, first_discard
  from jsonb_array_elements(shuffled_deck) with ordinality source(card, ordinal)
  where card->>'color' is not null and card->>'value' ~ '^[0-9]$'
  order by ordinal limit 1;
  if first_discard is null then raise exception 'DECK_SETUP_FAILED'; end if;
  shuffled_deck := shuffled_deck - discard_index;

  insert into public.match_internal_state (match_id, draw_pile, discard_pile)
  values (new_match_id, shuffled_deck, jsonb_build_array(first_discard));
  insert into public.public_match_state (match_id, current_player_id, direction, discard_top, active_color, draw_pile_count, turn_state)
  values (new_match_id, first_player_id, 1, first_discard, first_discard->>'color', jsonb_array_length(shuffled_deck),
    jsonb_build_object('drawnCardPending', false, 'pendingWildPlayerId', null, 'vulnerablePlayerId', null,
      'declaredPlayerId', null, 'winnerId', null, 'lastPenalty', null));
  insert into public.game_events (match_id, state_version, event_type, actor_player_id, public_payload)
  values (new_match_id, 0, 'game-started', first_player_id, jsonb_build_object('message', 'The round began.'));
  update public.rooms set status = 'active', state_version = state_version + 1 where id = target_room.id;
  return new_match_id;
end;
$$;

create function public.get_active_match(room_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.rooms;
  target_match public.matches;
  own_player_id uuid;
  own_participant_id uuid;
  result jsonb;
begin
  select * into target_room from public.rooms where code = upper(trim(room_code));
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if not public.is_room_member(target_room.id) then raise exception 'NOT_ROOM_MEMBER'; end if;
  select * into target_match from public.matches where room_id = target_room.id order by created_at desc limit 1;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;
  select ps.player_id into own_player_id from public.player_sessions ps
  where ps.auth_user_id = auth.uid() and ps.room_id = target_room.id and ps.expires_at > now() limit 1;
  select id into own_participant_id from public.match_participants
  where match_id = target_match.id and player_id = own_player_id;

  select jsonb_build_object(
    'match', jsonb_build_object('id', target_match.id, 'phase', target_match.phase, 'stateVersion', target_match.state_version,
      'startedAt', target_match.started_at, 'endedAt', target_match.ended_at),
    'publicState', jsonb_build_object('currentPlayerId', pms.current_player_id, 'direction', pms.direction,
      'discardTop', pms.discard_top, 'activeColor', pms.active_color, 'drawPileCount', pms.draw_pile_count,
      'turnState', pms.turn_state),
    'participants', (select jsonb_agg(jsonb_build_object('id', mp.id, 'playerId', mp.player_id,
      'displayName', p.display_name, 'turnPosition', mp.turn_position, 'handCount', mp.hand_count,
      'score', mp.score, 'stats', mp.stats) order by mp.turn_position)
      from public.match_participants mp join public.players p on p.id = mp.player_id where mp.match_id = target_match.id),
    'ownPlayerId', own_player_id,
    'ownHand', (select cards from public.private_player_hands where participant_id = own_participant_id),
    'ownDrawnCardId', (select case when pms.current_player_id = own_player_id then mis.drawn_card_id else null end
      from public.match_internal_state mis where mis.match_id = target_match.id),
    'events', coalesce((select jsonb_agg(event order by (event->>'id')::bigint) from (
      select jsonb_build_object('id', ge.id, 'stateVersion', ge.state_version, 'type', ge.event_type,
        'actorPlayerId', ge.actor_player_id, 'payload', ge.public_payload, 'createdAt', ge.created_at) event
      from public.game_events ge where ge.match_id = target_match.id order by ge.id desc limit 50
    ) recent), '[]'::jsonb)
  ) into result from public.public_match_state pms where pms.match_id = target_match.id;
  return result;
end;
$$;

create function public.submit_game_action(
  target_match_id uuid,
  action_id uuid,
  expected_version bigint,
  action_type text,
  action_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_match public.matches;
  public_state public.public_match_state;
  internal public.match_internal_state;
  actor_player_id uuid;
  actor_hand jsonb;
  played_card jsonb;
  discard_top jsonb;
  card_id text;
  selected_color text;
  target_player_id uuid;
  next_player_id uuid;
  penalized_player_id uuid;
  participant_count integer;
  remaining_count integer;
  drawn_cards jsonb;
  drawn_card jsonb;
  pending_value text;
  pending_winner boolean;
  event_type text;
  event_message text;
  event_payload jsonb := '{}'::jsonb;
  last_penalty jsonb := null;
  vulnerability_before uuid;
  declaration_before uuid;
  is_play_action boolean := false;
  declaration_was_used boolean := false;
  new_version bigint;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if action_type not in ('PLAY_CARD', 'DRAW_CARD', 'PLAY_DRAWN_CARD', 'KEEP_DRAWN_CARD', 'SELECT_WILD_COLOR', 'DECLARE_LAST_CARD', 'CALL_OUT_PLAYER') then
    raise exception 'UNKNOWN_ACTION';
  end if;
  if jsonb_typeof(action_payload) <> 'object' then raise exception 'INVALID_ACTION_PAYLOAD'; end if;
  if exists (select 1 from public.game_actions where id = action_id) then raise exception 'DUPLICATE_ACTION'; end if;

  select * into target_match from public.matches where id = target_match_id for update;
  if not found then raise exception 'MATCH_NOT_FOUND'; end if;
  if target_match.phase <> 'playing' then raise exception 'MATCH_ALREADY_ENDED'; end if;
  if target_match.state_version <> expected_version then raise exception 'STALE_VERSION'; end if;
  select mp.player_id into actor_player_id
  from public.match_participants mp
  join public.player_sessions ps on ps.player_id = mp.player_id
  where mp.match_id = target_match_id and ps.auth_user_id = auth.uid() and ps.expires_at > now() limit 1;
  if actor_player_id is null then raise exception 'NOT_MATCH_PARTICIPANT'; end if;
  select * into public_state from public.public_match_state where match_id = target_match_id for update;
  select * into internal from public.match_internal_state where match_id = target_match_id for update;
  select pph.cards into actor_hand from public.private_player_hands pph
  join public.match_participants mp on mp.id = pph.participant_id
  where mp.match_id = target_match_id and mp.player_id = actor_player_id for update of pph;
  discard_top := internal.discard_pile->(jsonb_array_length(internal.discard_pile) - 1);
  vulnerability_before := internal.vulnerable_player_id;
  declaration_before := internal.declared_player_id;

  if internal.pending_wild is not null and action_type not in ('SELECT_WILD_COLOR', 'DECLARE_LAST_CARD', 'CALL_OUT_PLAYER') then
    raise exception 'WILD_COLOR_REQUIRED';
  end if;

  if action_type in ('PLAY_CARD', 'PLAY_DRAWN_CARD') then
    is_play_action := true;
    if public_state.current_player_id <> actor_player_id then raise exception 'NOT_YOUR_TURN'; end if;
    card_id := action_payload->>'cardId';
    if card_id is null then raise exception 'CARD_ID_REQUIRED'; end if;
    if action_type = 'PLAY_DRAWN_CARD' then
      if internal.drawn_card_id is distinct from card_id then raise exception 'ONLY_DRAWN_CARD_ALLOWED'; end if;
    elsif internal.drawn_card_id is not null then raise exception 'RESOLVE_DRAWN_CARD_FIRST';
    end if;
    select card into played_card from jsonb_array_elements(actor_hand) source(card) where card->>'id' = card_id limit 1;
    if played_card is null then raise exception 'CARD_NOT_IN_HAND'; end if;
    if not public.card_is_playable(played_card, discard_top, public_state.active_color) then raise exception 'ILLEGAL_CARD_PLAY'; end if;

    select coalesce(jsonb_agg(card order by ordinal), '[]'::jsonb) into actor_hand
    from jsonb_array_elements(actor_hand) with ordinality source(card, ordinal) where card->>'id' <> card_id;
    internal.discard_pile := internal.discard_pile || jsonb_build_array(played_card);
    internal.drawn_card_id := null;
    remaining_count := jsonb_array_length(actor_hand);
    update public.private_player_hands set cards = actor_hand
    where participant_id = (select id from public.match_participants where match_id = target_match_id and player_id = actor_player_id);
    update public.match_participants set hand_count = remaining_count,
      stats = jsonb_set(stats, '{cardsPlayed}', to_jsonb(coalesce((stats->>'cardsPlayed')::integer, 0) + 1), true)
    where match_id = target_match_id and player_id = actor_player_id;

    if remaining_count = 1 then
      if internal.declared_player_id is distinct from actor_player_id then internal.vulnerable_player_id := actor_player_id; end if;
    else internal.vulnerable_player_id := null;
    end if;
    declaration_was_used := remaining_count = 1 and internal.declared_player_id = actor_player_id;
    internal.declared_player_id := case when declaration_was_used then actor_player_id else null end;

    event_type := 'card-played';
    event_message := (select display_name from public.players where id = actor_player_id) || ' played ' || played_card->>'value' || '.';
    event_payload := jsonb_build_object('message', event_message, 'card', played_card);

    if played_card->>'value' in ('wild', 'wild-draw-four') then
      internal.pending_wild := jsonb_build_object('playerId', actor_player_id, 'value', played_card->>'value', 'winnerAfterChoice', remaining_count = 0);
    else
      public_state.active_color := played_card->>'color';
      select count(*) into participant_count from public.match_participants where match_id = target_match_id;
      if played_card->>'value' = 'skip' then
        public_state.current_player_id := public.match_next_player(target_match_id, actor_player_id, public_state.direction, 2);
      elsif played_card->>'value' = 'reverse' then
        if participant_count = 2 then public_state.current_player_id := public.match_next_player(target_match_id, actor_player_id, public_state.direction, 2);
        else
          public_state.direction := -public_state.direction;
          public_state.current_player_id := public.match_next_player(target_match_id, actor_player_id, public_state.direction, 1);
        end if;
      elsif played_card->>'value' = 'draw-two' then
        penalized_player_id := public.match_next_player(target_match_id, actor_player_id, public_state.direction, 1);
        update public.match_internal_state set draw_pile = internal.draw_pile, discard_pile = internal.discard_pile,
          drawn_card_id = internal.drawn_card_id, pending_wild = internal.pending_wild,
          vulnerable_player_id = internal.vulnerable_player_id, declared_player_id = internal.declared_player_id
        where match_id = target_match_id;
        perform public.match_draw_cards(target_match_id, penalized_player_id, 2);
        select * into internal from public.match_internal_state where match_id = target_match_id;
        last_penalty := jsonb_build_object('playerId', penalized_player_id, 'amount', 2, 'reason', 'draw-two');
        public_state.current_player_id := public.match_next_player(target_match_id, actor_player_id, public_state.direction, 2);
      else public_state.current_player_id := public.match_next_player(target_match_id, actor_player_id, public_state.direction, 1);
      end if;
      if remaining_count = 0 then
        target_match.phase := 'won'; target_match.winner_player_id := actor_player_id; target_match.ended_at := now();
        internal.vulnerable_player_id := null; internal.declared_player_id := null;
      end if;
    end if;

  elsif action_type = 'DRAW_CARD' then
    if public_state.current_player_id <> actor_player_id then raise exception 'NOT_YOUR_TURN'; end if;
    if internal.drawn_card_id is not null then raise exception 'ALREADY_DREW_CARD'; end if;
    drawn_cards := public.match_draw_cards(target_match_id, actor_player_id, 1);
    select * into internal from public.match_internal_state where match_id = target_match_id;
    drawn_card := drawn_cards->0;
    if drawn_card is null then raise exception 'NO_CARDS_AVAILABLE'; end if;
    if public.card_is_playable(drawn_card, discard_top, public_state.active_color) then internal.drawn_card_id := drawn_card->>'id';
    else public_state.current_player_id := public.match_next_player(target_match_id, actor_player_id, public_state.direction, 1);
    end if;
    event_type := 'card-drawn';
    event_message := (select display_name from public.players where id = actor_player_id) || ' drew a card.';
    event_payload := jsonb_build_object('message', event_message);

  elsif action_type = 'KEEP_DRAWN_CARD' then
    if public_state.current_player_id <> actor_player_id then raise exception 'NOT_YOUR_TURN'; end if;
    if internal.drawn_card_id is null then raise exception 'NO_DRAWN_CARD'; end if;
    internal.drawn_card_id := null;
    public_state.current_player_id := public.match_next_player(target_match_id, actor_player_id, public_state.direction, 1);
    event_type := 'drawn-card-kept';
    event_message := (select display_name from public.players where id = actor_player_id) || ' kept the drawn card.';
    event_payload := jsonb_build_object('message', event_message);

  elsif action_type = 'SELECT_WILD_COLOR' then
    if internal.pending_wild is null or internal.pending_wild->>'playerId' <> actor_player_id::text then raise exception 'NO_WILD_CHOICE'; end if;
    selected_color := action_payload->>'color';
    if selected_color not in ('crimson', 'gold', 'emerald', 'azure') then raise exception 'INVALID_COLOR'; end if;
    pending_value := internal.pending_wild->>'value';
    pending_winner := coalesce((internal.pending_wild->>'winnerAfterChoice')::boolean, false);
    internal.pending_wild := null;
    public_state.active_color := selected_color;
    if pending_value = 'wild-draw-four' then
      penalized_player_id := public.match_next_player(target_match_id, actor_player_id, public_state.direction, 1);
      update public.match_internal_state set draw_pile = internal.draw_pile, discard_pile = internal.discard_pile,
        drawn_card_id = internal.drawn_card_id, pending_wild = internal.pending_wild,
        vulnerable_player_id = internal.vulnerable_player_id, declared_player_id = internal.declared_player_id
      where match_id = target_match_id;
      perform public.match_draw_cards(target_match_id, penalized_player_id, 4);
      select * into internal from public.match_internal_state where match_id = target_match_id;
      last_penalty := jsonb_build_object('playerId', penalized_player_id, 'amount', 4, 'reason', 'wild-draw-four');
      public_state.current_player_id := public.match_next_player(target_match_id, actor_player_id, public_state.direction, 2);
    else public_state.current_player_id := public.match_next_player(target_match_id, actor_player_id, public_state.direction, 1);
    end if;
    if pending_winner then
      target_match.phase := 'won'; target_match.winner_player_id := actor_player_id; target_match.ended_at := now();
      internal.vulnerable_player_id := null; internal.declared_player_id := null;
    end if;
    event_type := 'color-selected';
    event_message := (select display_name from public.players where id = actor_player_id) || ' chose ' || selected_color || '.';
    event_payload := jsonb_build_object('message', event_message, 'color', selected_color);

  elsif action_type = 'DECLARE_LAST_CARD' then
    remaining_count := jsonb_array_length(actor_hand);
    if not ((public_state.current_player_id = actor_player_id and remaining_count = 2 and internal.drawn_card_id is null)
      or (internal.vulnerable_player_id = actor_player_id and remaining_count = 1)) then raise exception 'INVALID_LAST_CARD_DECLARATION'; end if;
    internal.declared_player_id := actor_player_id; internal.vulnerable_player_id := null;
    event_type := 'last-card-declared';
    event_message := (select display_name from public.players where id = actor_player_id) || ' called “Last Card!”';
    event_payload := jsonb_build_object('message', event_message);

  elsif action_type = 'CALL_OUT_PLAYER' then
    begin target_player_id := (action_payload->>'targetPlayerId')::uuid; exception when others then raise exception 'INVALID_TARGET_PLAYER'; end;
    if target_player_id = actor_player_id or internal.vulnerable_player_id is distinct from target_player_id then raise exception 'INVALID_CALLOUT'; end if;
    if (select hand_count from public.match_participants where match_id = target_match_id and player_id = target_player_id) <> 1 then raise exception 'INVALID_CALLOUT'; end if;
    perform public.match_draw_cards(target_match_id, target_player_id, 2);
    select * into internal from public.match_internal_state where match_id = target_match_id;
    internal.vulnerable_player_id := null; internal.declared_player_id := null;
    last_penalty := jsonb_build_object('playerId', target_player_id, 'amount', 2, 'reason', 'missed-last-card');
    event_type := 'player-called-out';
    event_message := (select display_name from public.players where id = actor_player_id) || ' caught ' || (select display_name from public.players where id = target_player_id) || '.';
    event_payload := jsonb_build_object('message', event_message, 'targetPlayerId', target_player_id);
  end if;

  if action_type not in ('DECLARE_LAST_CARD', 'CALL_OUT_PLAYER') and vulnerability_before is not null then internal.vulnerable_player_id := null; end if;
  if action_type <> 'DECLARE_LAST_CARD' and declaration_before is not null and not declaration_was_used then internal.declared_player_id := null; end if;

  new_version := target_match.state_version + 1;
  update public.matches set phase = target_match.phase, winner_player_id = target_match.winner_player_id,
    ended_at = target_match.ended_at, state_version = new_version where id = target_match_id;
  update public.match_internal_state set draw_pile = internal.draw_pile, discard_pile = internal.discard_pile,
    drawn_card_id = internal.drawn_card_id, pending_wild = internal.pending_wild,
    vulnerable_player_id = internal.vulnerable_player_id, declared_player_id = internal.declared_player_id
  where match_id = target_match_id;
  update public.public_match_state set current_player_id = public_state.current_player_id, direction = public_state.direction,
    discard_top = internal.discard_pile->(jsonb_array_length(internal.discard_pile) - 1), active_color = public_state.active_color,
    draw_pile_count = jsonb_array_length(internal.draw_pile), turn_state = jsonb_build_object(
      'drawnCardPending', internal.drawn_card_id is not null,
      'pendingWildPlayerId', case when internal.pending_wild is null then null else internal.pending_wild->'playerId' end,
      'vulnerablePlayerId', internal.vulnerable_player_id, 'declaredPlayerId', internal.declared_player_id,
      'winnerId', target_match.winner_player_id, 'lastPenalty', last_penalty)
  where match_id = target_match_id;
  insert into public.game_actions (id, match_id, actor_player_id, expected_version, action_type, action_payload, accepted, processed_at)
  values (action_id, target_match_id, actor_player_id, expected_version, action_type, action_payload, true, now());
  insert into public.game_events (match_id, state_version, event_type, actor_player_id, public_payload)
  values (target_match_id, new_version, event_type, actor_player_id, event_payload);
  return jsonb_build_object('accepted', true, 'stateVersion', new_version);
end;
$$;

revoke all on function public.build_game_deck() from public;
revoke all on function public.card_is_playable(jsonb, jsonb, text) from public;
revoke all on function public.match_next_player(uuid, uuid, smallint, integer) from public;
revoke all on function public.match_draw_cards(uuid, uuid, integer) from public;
revoke all on function public.start_room(text) from public;
revoke all on function public.get_active_match(text) from public;
revoke all on function public.submit_game_action(uuid, uuid, bigint, text, jsonb) from public;
grant execute on function public.start_room(text) to authenticated;
grant execute on function public.get_active_match(text) to authenticated;
grant execute on function public.submit_game_action(uuid, uuid, bigint, text, jsonb) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'public_match_state') then
    alter publication supabase_realtime add table public.public_match_state;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'match_participants') then
    alter publication supabase_realtime add table public.match_participants;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'private_player_hands') then
    alter publication supabase_realtime add table public.private_player_hands;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_events') then
    alter publication supabase_realtime add table public.game_events;
  end if;
end $$;

comment on table public.match_internal_state is 'Authoritative draw order, discard history, and timing windows. No browser role has direct access.';
comment on function public.submit_game_action(uuid, uuid, bigint, text, jsonb) is 'Single transactional authority for Phase 4 moves; locks the match, validates ownership/version/rules, then updates public and private state atomically.';
