import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const SUPABASE_URL = 'https://ygskixbzfbdfkbfvgiju.supabase.co'
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_hJ7KNBSu5L4pU1hBXlRzFQ_JIODgqD-'

export const supabase = createClient(https://ygskixbzfbdfkbfvgiju.supabase.co, sb_publishable_hJ7KNBSu5L4pU1hBXlRzFQ_JIODgqD-)

export const auth = supabase.auth
export const db = supabase
export const storage = supabase.storage