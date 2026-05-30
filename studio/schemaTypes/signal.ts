import { defineType, defineField } from 'sanity'

export default defineType({
  name: 'signal',
  title: 'Signaal',
  type: 'document',
  description: 'Een waarneming die (nog) geen artikel is, maar die de redactie-routine in de gaten houdt.',
  fields: [
    defineField({ name: 'title', title: 'Korte beschrijving', type: 'string', validation: (rule) => rule.required() }),
    defineField({
      name: 'status',
      title: 'Status',
      type: 'string',
      options: {
        list: [
          { title: 'Nieuw', value: 'new' },
          { title: 'In de gaten houden', value: 'watching' },
          { title: 'Onderzoek gestart', value: 'researching' },
          { title: 'Verwerkt tot artikel', value: 'published' },
          { title: 'Geparkeerd', value: 'parked' },
          { title: 'Afgevallen', value: 'discarded' },
        ],
      },
      initialValue: 'new',
    }),
    defineField({ name: 'summary', title: 'Samenvatting', type: 'text', rows: 4, description: 'Wat is er waargenomen? Door welke bron?' }),
    defineField({ name: 'confirmations', title: 'Aantal bevestigingen', type: 'number', initialValue: 1 }),
    defineField({ name: 'threshold', title: 'Drempel voor artikel', type: 'number', initialValue: 2 }),
    defineField({ name: 'sources', title: 'Bronnen', type: 'array', of: [{ type: 'reference', to: [{ type: 'source' }] }] }),
    defineField({ name: 'tags', title: 'Tags', type: 'array', of: [{ type: 'reference', to: [{ type: 'tag' }] }] }),
    defineField({ name: 'persons', title: 'Betrokken personen', type: 'array', of: [{ type: 'reference', to: [{ type: 'person' }] }] }),
    defineField({ name: 'organizations', title: 'Betrokken organisaties', type: 'array', of: [{ type: 'reference', to: [{ type: 'organization' }] }] }),
    defineField({ name: 'locations', title: 'Locaties', type: 'array', of: [{ type: 'reference', to: [{ type: 'location' }] }] }),
    defineField({ name: 'firstSeenAt', title: 'Eerste keer gezien', type: 'datetime' }),
    defineField({ name: 'lastSeenAt', title: 'Laatste keer gezien', type: 'datetime' }),
  ],
  preview: {
    select: { title: 'title', subtitle: 'status', confirmations: 'confirmations' },
    prepare({ title, subtitle, confirmations }: any) {
      return { title, subtitle: `${subtitle} — ${confirmations || 0} bevestiging(en)` }
    },
  },
})
