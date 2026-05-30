import { defineType, defineField } from 'sanity'

export default defineType({
  name: 'location',
  title: 'Locatie / wijk',
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
          { title: 'Wijk', value: 'neighborhood' },
          { title: 'Deelgebied', value: 'area' },
          { title: 'Landmark', value: 'landmark' },
        ],
      },
      initialValue: 'neighborhood',
    }),
    defineField({ name: 'description', title: 'Beschrijving', type: 'text', rows: 2 }),
  ],
  preview: { select: { title: 'name', subtitle: 'type' } },
})
