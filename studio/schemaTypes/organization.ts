import { defineType, defineField } from 'sanity'

export default defineType({
  name: 'organization',
  title: 'Organisatie',
  type: 'document',
  fields: [
    defineField({ name: 'name', title: 'Naam', type: 'string', validation: (rule) => rule.required() }),
    defineField({ name: 'slug', title: 'Slug', type: 'slug', options: { source: 'name' }, validation: (rule) => rule.required() }),
    defineField({
      name: 'type',
      title: 'Type',
      type: 'string',
      options: {
        list: [
          { title: 'Gemeente / overheid', value: 'government' },
          { title: 'Bedrijf', value: 'company' },
          { title: 'Stichting / vereniging', value: 'nonprofit' },
          { title: 'Onderwijsinstelling', value: 'education' },
          { title: 'Zorginstelling', value: 'healthcare' },
          { title: 'Overig', value: 'other' },
        ],
      },
    }),
    defineField({ name: 'website', title: 'Website', type: 'url' }),
    defineField({ name: 'notes', title: 'Notities', type: 'text', rows: 3, description: 'Interne notities, niet zichtbaar op de site' }),
  ],
  preview: { select: { title: 'name', subtitle: 'type' } },
})
