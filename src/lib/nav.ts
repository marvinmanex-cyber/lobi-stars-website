// Main navigation, used by the header (desktop + mobile menu) and the search
// page's list of site pages.
// external: opens in a new tab.
import { clubValues, communityContent, clubDocuments } from './club';

export type NavLink = { label: string; href: string; description?: string; external?: boolean };
/** highlight: shown as a green pill button with a small food icon (MatchDay Kitchen). */
export type NavItem = NavLink & { children?: NavLink[]; highlight?: boolean };

// Values, Community and Transparency only appear once they have content.
const community = await communityContent();
export const optionalClub: NavLink[] = [
  ...(clubValues.ready ? [{ label: 'Values', href: '/club/values', description: 'Our mission and values' }] : []),
  ...(community.ready ? [{ label: 'Community', href: '/club/community', description: 'Community projects, clinics and charity work' }] : []),
  ...(clubDocuments.length ? [{ label: 'Transparency', href: '/club/transparency', description: 'Annual reports and official statements' }] : []),
];

export const MAIN_NAV: NavItem[] = [
  { label: 'News', href: '/news', description: 'The latest club news' },
  {
    label: 'Matches', href: '/fixtures',
    children: [
      { label: 'Fixtures', href: '/fixtures', description: 'Upcoming First Team matches' },
      { label: 'Results', href: '/results', description: 'Recent First Team results' },
      { label: 'Table', href: '/table', description: 'The league table' },
      { label: 'Stats', href: '/stats', description: 'Top scorers, assists, clean sheets and team record' },
      { label: 'Watch Live', href: '/watch', description: 'Live streams and full match replays of home games' },
      { label: 'Match Commentary', href: '/commentary', description: 'Lobi Stars FC Live: listen live to every match' },
      { label: 'Man of the Match', href: '/man-of-the-match', description: 'Vote for the Man of the Match at home games' },
      { label: 'Predict & Win', href: '/predict-and-win', description: 'Predict the exact score of home games for free to win ₦10,000' },
      { label: 'Fan Awards', href: '/awards', description: 'Vote for Goal of the Month, Player of the Month and Player of the Season' },
    ],
  },
  { label: 'MatchDay Kitchen', href: '/kitchen/', description: 'Order food and drinks to your seat at McCarthy Stadium', highlight: true },
  { label: 'Squad', href: '/squad', description: 'The First Team squad' },
  { label: 'Video', href: '/video', description: 'Press conferences, training and highlights' },
  {
    // Everything for a visit to McCarthy Stadium on match day.
    label: 'Tickets', href: '/tickets',
    children: [
      { label: 'Buy Match Tickets', href: '/tickets', description: 'Tickets for every Lobi Stars home match' },
      { label: 'Hospitality', href: '/hospitality', description: 'Matchday hospitality for businesses and groups' },
      { label: 'Matchday Programme', href: '/programme', description: 'Read the matchday programme free' },
    ],
  },
  { label: 'Shop', href: '/shop', description: 'Official club merchandise' },
  {
    label: 'Club', href: '/club',
    children: [
      { label: 'History', href: '/club/history', description: 'The story of Lobi Stars FC' },
      { label: 'Honours', href: '/club/honours', description: 'Trophies and titles' },
      { label: 'Stadium', href: '/club/stadium', description: 'McCarthy Stadium, Makurdi' },
      { label: 'Partners', href: '/partners', description: 'Our sponsors and partnership enquiries' },
      { label: 'Fan Clubs', href: '/club/fan-clubs', description: 'Supporters clubs' },
      ...optionalClub,
    ],
  },
  { label: 'Membership', href: '/membership', description: 'Join as an official member' },
  { label: 'Help', href: '/help', description: 'Help and contact details' },
];

// Other public pages that search should know about.
export const EXTRA_PAGES: NavLink[] = [
  { label: 'Contact', href: '/contact', description: 'Address, phone, email and contact form' },
  { label: 'Newsletter', href: '/newsletter', description: 'Sign up for the free Lobi Stars Weekly newsletter' },
  { label: 'Gallery', href: '/gallery', description: 'Photos from matchdays and club events' },
  { label: 'About the Club', href: '/club', description: 'About Lobi Stars FC' },
  { label: 'Privacy Policy', href: '/privacy', description: 'How we use your data' },
  { label: 'Terms of Use', href: '/terms', description: 'Website terms' },
  { label: 'Accessibility', href: '/accessibility', description: 'How the website works for everyone, and how to report a problem' },
];
