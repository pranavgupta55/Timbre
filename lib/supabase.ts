import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder';

// Provide a helpful console warning if we are using placeholders
if (supabaseUrl === 'https://placeholder.supabase.co') {
  console.warn('⚠️ Supabase URL is using a placeholder. Please update .env.local');
}

export const supabase = createClient(supabaseUrl, supabaseKey);