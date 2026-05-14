CREATE TABLE public.chat_reactions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id uuid NOT NULL REFERENCES public.chat_messages(id)
    ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id)
    ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX chat_reactions_unique
  ON public.chat_reactions (message_id, user_id, emoji);
ALTER TABLE public.chat_reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own reactions"
  ON public.chat_reactions
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can read all reactions"
  ON public.chat_reactions
  FOR SELECT TO authenticated
  USING (true);

-- Realtime: enable in Dashboard → Replication if needed, or:
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_reactions;
