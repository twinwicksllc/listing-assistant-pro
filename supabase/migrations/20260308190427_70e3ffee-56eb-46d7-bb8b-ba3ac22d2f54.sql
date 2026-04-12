CREATE TABLE public.cost_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  total_cost numeric NOT NULL,
  total_requests integer NOT NULL,
  threshold numeric NOT NULL DEFAULT 50,
  sent_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.cost_alerts ENABLE ROW LEVEL SECURITY;

-- No RLS policies needed - only accessed by service role from edge functions