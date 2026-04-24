import { createClient } from '@supabase/supabase-js';

const supabaseGlassUrl = process.env.NEXT_PUBLIC_SUPABASE_GLASS_URL!;
const supabaseGlassAnonKey = process.env.NEXT_PUBLIC_SUPABASE_GLASS_ANON_KEY!;

export const supabaseGlass = createClient(supabaseGlassUrl, supabaseGlassAnonKey);
