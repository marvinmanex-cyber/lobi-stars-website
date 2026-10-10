// Main navigation, used by the header (desktop + mobile menu) and the search
// page's list of site pages.
// external: opens in a new tab.
export type NavLink = { label: string; href: string; description?: string; external?: boolean };
export type NavItem = NavLink & { children?: NavLink[] };

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
  { label: 'Squad', href: '/squad', description: 'The First Team squad' },
  { label: 'Video', href: '/video', description: 'Press conferences, training and highlights' },
  { label: 'Tickets', href: '/tickets', description: 'Buy match tickets online' },
  { label: 'Shop', href: '/shop', description: 'Official club merchandise' },
  {
    label: 'Club', href: '/club',
    children: [
      { label: 'History', href: '/club/history', description: 'The story of Lobi Stars FC' },
      { label: 'Honours', href: '/club/honours', description: 'Trophies and titles' },
      { label: 'Stadium', href: '/club/stadium', description: 'McCarthy Stadium, Makurdi' },
      { label: 'Partners', href: '/partners', description: 'Our sponsors and partnership enquiries' },
      { label: 'Fan Clubs', href: '/club/fan-clubs', description: 'Supporters clubs' },
    ],
  },
  { label: 'Membership', href: '/membership', description: 'Join as an official member' },
  { label: 'Help', href: '/help', description: 'Help and contact details' },
];

// Other public pages that search should know about.
export const EXTRA_PAGES: NavLink[] = [
  { label: 'Contact', href: '/contact', description: 'Address, phone, email and contact form' },
  { label: 'In-Seat Food Ordering', href: '/food', description: 'Order food to your seat on matchday' },
  { label: 'Hospitality', href: '/hospitality', description: 'Matchday hospitality for businesses and groups' },
  { label: 'Matchday Programme', href: '/programme', description: 'Download the matchday programme' },
  { label: 'Gallery', href: '/gallery', description: 'Photos from matchdays and club events' },
  { label: 'About the Club', href: '/club', description: 'About Lobi Stars FC' },
  { label: 'Privacy Policy', href: '/privacy', description: 'How we use your data' },
  { label: 'Terms of Use', href: '/terms', description: 'Website terms' },
];
