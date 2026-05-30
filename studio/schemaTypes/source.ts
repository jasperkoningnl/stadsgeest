import { defineType, defineField } from 'sanity'

export default defineType({
  name: 'source',
  title: 'Bron',
  type: 'document',
  fields: [
    defineField({
      name: 'name',
      title: 'Naam / beschrijving',
      type: 'string',
      validation: (rule) => rule.required(),
      description: 'Bijv. "Gemeenteraadsbesluit 2026-05-20" of "AD Amersfoort, 26 mei 2026"',
    }),
    defineField({ name: 'url', title: 'URL', type: 'url' }),
    defineField({
      name: 'sourceType',
      title: 'Type bron',
      type: 'string',
      options: {
        list: [
          { title: 'Overheidsbesluit / bekendmaking', value: 'government' },
          { title: 'Nieuwsartikel', value: 'news' },
          { title: 'Persbericht', value: 'press' },
          { title: 'Onderzoeksrapport', value: 'research' },
          { title: 'Database / register', value: 'database' },
          { title: 'Social media / forum', value: 'social' },
          { title: 'Eigen onderzoek', value: 'original' },
          { title: 'Interview / contact', value: 'interview' },
        ],
      },
    }),
    defineField({
      name: 'reliability',
      title: 'Betrouwbaarheid',
      type: 'string',
      options: {
        list: [
          { title: 'Primair — officieel, verifieerbaar', value: 'primary' },
          { title: 'Secundair — betrouwbaar maar niet primair', value: 'secondary' },
          { title: 'Signaal — niet geverifieerd', value: 'signal' },
        ],
        layout: 'radio',
      },
    }),
    defineField({ name: 'retrievedAt', title: 'Opgehaald op', type: 'datetime' }),
  ],
  preview: { select: { title: 'name', subtitle: 'sourceType' } },
})
