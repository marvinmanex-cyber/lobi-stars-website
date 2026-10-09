import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const news = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/news' }),
  // The file name is the article's id and URL slug (/news/<file-name>).
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    category: z.enum(['First Team', 'Club', 'Tickets', 'Media Watch']),
    coverImage: z.string(),
    imageAlt: z.string(),
    publishedAt: z.coerce.date(),
    isVideo: z.boolean().default(false),
    // Sveltia CMS writes `null`/"" for empty optional fields.
    videoUrl: z.string().nullable().optional(),
    videoDuration: z.string().nullable().optional(),
    isFeatured: z.boolean().default(false),
    // Shown in the wide promo banner on the homepage (newest one wins).
    isBanner: z.boolean().default(false),
    // Placeholder content: shown with a "SAMPLE" label until replaced.
    isSample: z.boolean().default(false),
  }),
});

const players = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/players' }),
  // The file name is the profile URL: /squad/<file-name>. The body is the bio.
  schema: z.object({
    name: z.string(),
    position: z.enum(['GK', 'DEF', 'MID', 'FWD']),
    number: z.number(),
    nationality: z.string().default('Nigeria'),
    stateOfOrigin: z.string().nullable().optional(),
    dateOfBirth: z.coerce.date().nullable().optional(),
    height: z.string().nullable().optional(),
    preferredFoot: z.enum(['Left', 'Right', 'Both']).nullable().optional(),
    apps: z.number().nullable().default(0),
    goals: z.number().nullable().default(0),
    assists: z.number().nullable().default(0),
    cleanSheets: z.number().nullable().default(0),
    photo: z.string().nullable().optional(),
    isSample: z.boolean().default(false),
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
    // Sveltia CMS writes `null` (not omitted) for empty number fields, so
    // accept null as well as a missing value.
    home_score: z.number().nullable().optional(),
    away_score: z.number().nullable().optional(),
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
    // Management appear on /club/management; Coaching Staff also on /squad.
    group: z.enum(['Management', 'Coaching Staff']).default('Management'),
  }),
});

const heroSlides = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/hero-slides' }),
  schema: z.object({
    photo: z.string(),
    order: z.number().default(0),
  }),
});

export const PARTNER_TIERS = [
  'Principal Partner',
  'Official Kit Partner',
  'Official Club Partners',
  'Official Suppliers',
  'Media & Broadcast Partners',
  'Institutional & Community Partners',
] as const;

const partners = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/partners' }),
  // The file name is the partner's slug: /partners/<file-name>. The body is
  // the longer description shown on the detail page.
  schema: z.object({
    name: z.string(),
    tier: z.enum(PARTNER_TIERS),
    category: z.string(),
    officialTitle: z.string(),
    logo: z.string().nullable().optional(),
    logoDark: z.string().nullable().optional(),
    website: z.string().nullable().optional(),
    shortDescription: z.string().default(''),
    since: z.coerce.number().int().nullable().optional(),
    displayOrder: z.number().default(10),
    active: z.boolean().default(true),
    ageRestricted: z.boolean().default(false),
  }),
});

export const collections = { news, players, gallery, fixtures, staff, heroSlides, partners };
