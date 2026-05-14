CREATE TABLE public.tournament_mvp_votes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  match_id uuid NOT NULL REFERENCES
    public.tournament_matches(id) ON DELETE CASCADE,
  voter_user_id uuid NOT NULL REFERENCES
    public.profiles(id) ON DELETE CASCADE,
  voted_for_name text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (match_id, voter_user_id)
);

ALTER TABLE public.tournament_mvp_votes
  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own votes"
  ON public.tournament_mvp_votes
  FOR ALL TO authenticated
  USING (voter_user_id = auth.uid())
  WITH CHECK (voter_user_id = auth.uid());

CREATE POLICY "Users can read all votes"
  ON public.tournament_mvp_votes
  FOR SELECT TO authenticated
  USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.tournament_mvp_votes;
