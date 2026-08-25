import { createClient, type Client, type InArgs } from '@libsql/client'

let client: Client | null = null

if (process.env.TURSO_URL && process.env.TURSO_AUTH_TOKEN) {
  client = createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  })
} else if (process.env.NODE_ENV === 'development') {
  console.warn('[turso] TURSO_URL / TURSO_AUTH_TOKEN niet ingesteld — dashboard draait zonder database')
}

export const turso = client

export function hasTurso(): boolean {
  return turso !== null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function q<T = any>(sql: string, args: InArgs = []): Promise<T[]> {
  if (!turso) return []
  const res = await turso.execute({ sql, args })
  return res.rows as unknown as T[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function qOne<T = any>(sql: string, args: InArgs = []): Promise<T | null> {
  const rows = await q<T>(sql, args)
  return rows[0] ?? null
}
