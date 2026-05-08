alter table public.profiles drop constraint if exists profiles_position_check;
alter table public.profiles add constraint profiles_position_check check (
  playing_position is null
  or playing_position in ('Goalkeeper', 'Defender', 'Midfielder', 'Attacker')
);

