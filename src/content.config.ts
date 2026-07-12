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

const staff = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/staff' }),
  schema: z.object({
    name: z.string(),
    role: z.string(),
    initials: z.string(),
    bio: z.string(),
    photo: z.string().optional(),
    order: z.number().default(0),
  }),
});

const merchandise = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/merchandise' }),
  schema: z.object({
    name: z.string(),
    price: z.string().default('₦0'),
    description: z.string(),
    photo: z.string(),
    badge: z.string().optional(),
    badgeColor: z.string().default('#D4202B'),
    shopUrl: z.string().default('https://www.jumia.com.ng'),
  }),
});

const heroSlides = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/hero-slides' }),
  schema: z.object({
    photo: z.string(),
    order: z.number().default(0),
  }),
});

const sponsors = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/sponsors' }),
  schema: z.object({
    name: z.string(),
    logo: z.string(),
    url: z.string().default('#'),
    order: z.number().default(0),
  }),
});

export const collections = { news, players, gallery, fixtures, staff, merchandise, heroSlides, sponsors };
