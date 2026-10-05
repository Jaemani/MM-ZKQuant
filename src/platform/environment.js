export function databaseUrl(values) {
  if (values.DATABASE_URL) return values.DATABASE_URL;
  const projectId = values.SUPABASE_PROJECT_ID;
  const password = values.SUPABASE_DB_PASSWORD;
  if (!projectId || !password) throw Error('DATABASE_URL or SUPABASE_PROJECT_ID and SUPABASE_DB_PASSWORD are required');
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${projectId}.supabase.co:5432/postgres?sslmode=require`;
}
