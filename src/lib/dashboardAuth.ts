// Gedeelde authenticatieconstanten voor het redactionele dashboard.
// Gebruikt door src/proxy.ts (site-brede cookie-check) en door dashboard-API-routes
// die zichzelf expliciet moeten controleren, onafhankelijk van de proxy.

export const AUTH_COOKIE = 'sg_auth'
// SHA-256 hash van het dashboardwachtwoord; dit is tevens de geldige cookiewaarde.
export const AUTH_TOKEN = 'f28d5b97fc847044a60e7d675cf6dfd83e329c4b52224825ce9d1142b62f6252'

export function isAuthedCookieHeader(cookieHeader: string | null | undefined): boolean {
  if (!cookieHeader) return false
  return cookieHeader
    .split(';')
    .some((part) => {
      const [name, ...rest] = part.trim().split('=')
      return name === AUTH_COOKIE && rest.join('=') === AUTH_TOKEN
    })
}
