import { defineType, defineField } from 'sanity'

export default defineType({
  name: 'tag',
  title: 'Tag',
  type: 'document',
  fields: [
    defineField({ name: 'name', title: 'Naam', type: 'string', validation: (rule) => rule.required() }),
    defineField({ name: 'slug', title: 'Slug', type: 'slug', options: { source: 'name' }, validation: (rule) => rule.required() }),
    defineField({ name: 'description', title: 'Beschrijving', type: 'text', rows: 2 }),
    defineField({ name: 'color', title: 'Kleur', type: 'string', description: 'Hex-kleur voor weergave op de site (bijv. #2563EB)' }),
  ],
  preview: { select: { title: 'name' } },
})
