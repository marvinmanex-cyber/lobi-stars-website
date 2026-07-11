import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const news = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/news' }),
  schema: z.object({
    title: z.string(),
    category: z.enum(['Match Report', 'Transfers', 'Club News', 'Academy', 'Community']),
    date: z.date(),
    excerpt: z.string(),
    image: z.string().optional(),
  }),
});

const players = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/players' }),
  schema: z.object({
    name: z.string(),
    position: z.enum(['GK', 'DEF', 'MID', 'FWD']),
    number: z.number(),
    nationality: z.string().default('Nigeria'),
    apps: z.number().default(0),
    goals: z.number().default(0),
    photo: z.string().optional(),
  }),
});

const gallery = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/gallery' }),
  schema: z.object({
    caption: z.string(),
    photo: z.string(),
  }),
});

const fixtures = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/fixtures' }),
  schema: z.object({
    home: z.string(),
    away: z.string(),
    date: z.date(),
    venue: z.string(),
    competition: z.string().default('NPFL'),
    home_score: z.number().optional(),
    away_score: z.number().optional(),
    status: z.enum(['Upcoming', 'Completed']),
  }),
});

export const collections = { news, players, gallery, fixtures };
