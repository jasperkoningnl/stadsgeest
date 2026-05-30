import { defineType, defineField } from 'sanity'

export default defineType({
  name: 'report',
  title: 'Melding',
  type: 'document',
  fields: [
    defineField({ name: 'article', title: 'Artikel', type: 'reference', to: [{ type: 'article' }], validation: (rule) => rule.required() }),
    defineField({ name: 'message', title: 'Melding', type: 'text', rows: 4, validation: (rule) => rule.required().min(10).max(1000) }),
    defineField({ name: 'sessionHash', title: 'Sessie-hash', type: 'string', description: 'Voor deduplicatie', readOnly: true }),
    defineField({ name: 'resolved', title: 'Afgehandeld', type: 'boolean', initialValue: false }),
    defineField({
      name: 'resolvedNote',
      title: 'Afhandeling',
      type: 'text',
      rows: 2,
      description: 'Wat is er met deze melding gedaan?',
      hidden: ({ parent }: any) => !parent?.resolved,
    }),
  ],
  preview: {
    select: { articleTitle: 'article.title', resolved: 'resolved', message: 'message' },
    prepare({ articleTitle, resolved, message }: any) {
      return {
        title: `${resolved ? '✅' : '🔴'} ${articleTitle || 'Onbekend artikel'}`,
        subtitle: message?.substring(0, 80),
      }
    },
  },
})
