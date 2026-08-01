export default function NoDatabase() {
  return (
    <div className="empty-state">
      Geen verbinding met de Turso-database — <code>TURSO_URL</code> / <code>TURSO_AUTH_TOKEN</code> ontbreken in deze omgeving.
    </div>
  )
}
