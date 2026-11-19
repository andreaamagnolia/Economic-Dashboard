// Public settings for the website.
// Only the PUBLIC key belongs here (the "anon" key or a "publishable" key, sb_publishable_…).
// NEVER put the service_role / secret key in this file: every visitor can read it.
// Read-only access is enforced by Row Level Security in supabase/schema.sql.
window.KABAR_CONFIG = {
  supabaseUrl: 'https://fedpxswqnmnrfgywjztj.supabase.co',
  // anon (public) key: read-only for visitors thanks to Row Level Security
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZlZHB4c3dxbm1ucmZneXdqenRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUwNTE3MTUsImV4cCI6MjExMDYyNzcxNX0.sNB_0tCjCXwJjaHsYT33xzoJ0U2nf-LM8DIWq3Kv8ck'
};
