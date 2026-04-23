import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = "https://ygskixbzfbdfkbfvgiju.supabase.co";
const supabaseKey = "sb_publishable_hJ7KNBSu5L4pU1hBXlRzFQ_JIODgqD-";

export const supabase = createClient(supabaseUrl, supabaseKey);
export const db = supabase;
export const supaAuth = supabase.auth;