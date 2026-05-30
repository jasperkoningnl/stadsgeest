import { defineType, defineField } from 'sanity'

export default defineType({
  name: 'person',
  title: 'Persoon',
  type: 'document',
  fields: [
    defineField({ name: 'name', title: 'Naam', type: 'string', validation: (rule) => rule.required() }),
    defineField({ name: 'slug', title: 'Slug', type: 'slug', options: { source: 'name' }, validation: (rule) => rule.required() }),
    defineField({ name: 'role', title: 'Functie / rol', type: 'string', description: 'Bijv. "Wethouder gemeente Amersfoort"' }),
    defineField({ name: 'organization', title: 'Organisatie', type: 'reference', to: [{ type: 'organization' }], weak: true }),
    defineField({ name: 'notes', title: 'Notities', type: 'text', rows: 3, description: 'Interne notities, niet zichtbaar op de site' }),
  ],
  preview: { select: { title: 'name', subtitle: 'role' } },
})
