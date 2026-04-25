import { createBrowserClient } from '@supabase/ssr';

export function createSupabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://vzwlugdsgcrzhqzmktae.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6d2x1Z2RzZ2Nyemhxem1rdGFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5NDEzMzgsImV4cCI6MjA5MjUxNzMzOH0.Uo5tWBrZ38_mYk5RqpeFXWGjx5jm7PvPwm3-choW6pw'
  );
}
