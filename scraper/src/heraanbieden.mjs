// heraanbieden.mjs — een signaal opnieuw aan de weger aanbieden als een stuk
// pas ná de eerste weging zijn tekst krijgt. Toegevoegd 2026-10-03.
//
// De weger pakt een signaal opnieuw op wanneer last_seen_at nieuwer is dan zijn
// laatste oordeel en de status new of watching is (weger-workset.cjs). Deze
// functie zet last_seen_at op nu, zet een weggezet signaal terug op watching en
// legt de reden vast in signal_events. Signalen met een tip of met een
// eindstatus (published, parked, researching) blijven ongemoeid.
//
// signal_items heeft geen index op raw_item_id: één aanroep leest de hele
// koppeltabel (enkele duizenden rijen). Bedoeld voor een handvol aanroepen per
// run, niet voor een lus over honderden items; zie docs/DATABASE-LEZEN.md.

export async function biedSignalenOpnieuwAan(db, rawItemId, { actor, reden }) {
  const res = await db.execute({
    sql: `SELECT s.id, s.status
          FROM signal_items si JOIN signals s ON s.id = si.signal_id
          WHERE si.raw_item_id = ? AND s.status IN ('new', 'watching', 'discarded')
            AND NOT EXISTS (SELECT 1 FROM tip_signals ts WHERE ts.signal_id = s.id)`,
    args: [rawItemId],
  });
  for (const s of res.rows) {
    const naar = s.status === 'discarded' ? 'watching' : s.status;
    await db.batch([
      { sql: "UPDATE signals SET last_seen_at = datetime('now'), status = ? WHERE id = ?", args: [naar, s.id] },
      { sql: `INSERT INTO signal_events (signal_id, actor, event_type, status_from, status_to, reason)
              VALUES (?, ?, 'reoffered', ?, ?, ?)`, args: [s.id, actor, s.status, naar, reden] },
    ], 'write');
  }
  return res.rows.length;
}
