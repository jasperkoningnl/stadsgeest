export default function GeenDatabase() {
  return (
    <div className="np-leeg">
      <p className="np-leeg-kop">Geen verbinding met de database</p>
      <p>
        De omgevingsvariabelen <code>TURSO_URL</code> en <code>TURSO_AUTH_TOKEN</code> ontbreken.
        Zonder die twee kan dit dashboard niets tonen. Dit is een instelling, geen storing in de pipeline.
      </p>
    </div>
  )
}
