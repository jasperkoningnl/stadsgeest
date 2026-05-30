import { defineType, defineField } from 'sanity'

export default defineType({
  name: 'siteSettings',
  title: 'Site-instellingen',
  type: 'document',
  fields: [
    defineField({ name: 'siteName', title: 'Sitenaam', type: 'string', initialValue: 'Amersfoort Lokaal' }),
    defineField({ name: 'siteDescription', title: 'Sitebeschrijving', type: 'text', rows: 2 }),
    defineField({
      name: 'reportThreshold',
      title: 'Meldingsdrempel',
      type: 'number',
      initialValue: 3,
      description: 'Bij dit aantal meldingen gaat een artikel automatisch op review',
    }),
    defineField({
      name: 'aiDisclaimer',
      title: 'AI-disclaimer',
      type: 'text',
      rows: 3,
      description: 'Standaardtekst die op elke pagina wordt getoond',
      initialValue: 'Amersfoort Lokaal is een AI-gedreven nieuwssite. Artikelen worden geschreven door kunstmatige intelligentie op basis van openbare bronnen. Zie je een fout? Meld het via de knop onder elk artikel.',
    }),
  ],
})
