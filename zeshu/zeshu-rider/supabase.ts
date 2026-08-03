import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';

// We use EXPO_PUBLIC_ prefix so Expo knows to expose these to the app
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://isofiudzgpuxgenzicdb.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_L_t4o3htIkfQNTgK-qnvng_6Hlhdn7J';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);