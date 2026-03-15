export type Category = "music" | "food" | "fitness" | "social" | "arts";

export type EventPin = {
  id: string;
  title: string;
  venue: string;
  timeLabel: string;
  startAtIso?: string;
  photoUrl: string;
  sourceUrl?: string;
  description?: string;
  location: [number, number];
  category: Category;
  spontaneityScore: number;
  crowdLabel: "Low-key" | "Good vibe" | "Packed";
  tags: string[];
  priceTier?: "free" | "budget" | "mid" | "premium" | "unknown";
  alcoholPolicy?: "alcoholic" | "non_alcoholic" | "mixed" | "unknown";
  isSports?: boolean;
  subcategories?: string[];
};

export const DEFAULT_LOCATION: [number, number] = [-37.9105, 145.1362];

export const MOCK_EVENTS: EventPin[] = [
  {
    id: "1",
    title: "The Game Expo 2026",
    venue: "Melbourne Convention and Exhibition Centre, South Wharf",
    timeLabel: "Sat 14 Mar, 10:00 AM - 6:00 PM",
    photoUrl:
      "https://images.unsplash.com/photo-1542751110-97427bbecf20?auto=format&fit=crop&w=420&q=80",
    sourceUrl: "https://www.mcec.com.au/whats-on/2026/03/the-game-expo",
    location: [-37.8242, 144.9561],
    category: "social",
    spontaneityScore: 88,
    crowdLabel: "Good vibe",
    tags: ["Gaming", "Cosplay", "Tournaments"],
  },
  {
    id: "2",
    title: "Melbourne Samba Encontro Showcase",
    venue: "Collingwood Town Hall, Abbotsford",
    timeLabel: "Sat 14 Mar, 7:00 PM - 11:59 PM",
    photoUrl:
      "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=420&q=80",
    sourceUrl: "https://www.eventbrite.com.au/e/melbourne-samba-encontro-tickets-1978709670891",
    location: [-37.8039, 144.9928],
    category: "music",
    spontaneityScore: 85,
    crowdLabel: "Packed",
    tags: ["Samba", "Live drums", "Dance"],
  },
  {
    id: "3",
    title: "RETURN OF SIR M - AJIB Melbourne Tour",
    venue: "Chaise Lounge, Melbourne",
    timeLabel: "Sat 14 Mar, 10:00 AM",
    photoUrl:
      "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=420&q=80",
    sourceUrl:
      "https://www.eventbrite.com.au/e/return-of-sir-m-hosted-by-ajib-melbourne-tour-tickets-1983360969049",
    location: [-37.8131, 144.9633],
    category: "fitness",
    spontaneityScore: 78,
    crowdLabel: "Good vibe",
    tags: ["Hip hop", "Live set", "Tour show"],
  },
  {
    id: "4",
    title: "Non Profit Finance Training - Melbourne",
    venue: "Online (Melbourne timezone)",
    timeLabel: "Wed 18 Mar, 11:00 AM - 4:30 PM",
    photoUrl:
      "https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?auto=format&fit=crop&w=420&q=80",
    sourceUrl:
      "https://www.eventbrite.com.au/e/non-profit-finance-training-melbourne-march-2026-tickets-1927287882939",
    location: [-37.9105, 145.1362],
    category: "social",
    spontaneityScore: 65,
    crowdLabel: "Low-key",
    tags: ["Workshop", "Finance", "Professional"],
  },
  {
    id: "5",
    title: "Campfire",
    venue: "Midnightsky Studio 2, Fitzroy",
    timeLabel: "Sat 14 Mar, 7:00 PM - 10:00 PM",
    photoUrl:
      "https://images.unsplash.com/photo-1470229538611-16ba8c7ffbd7?auto=format&fit=crop&w=420&q=80",
    sourceUrl: "https://events.humanitix.com/campfire-saturday-14th-march-2026",
    location: [-37.7986, 144.9784],
    category: "arts",
    spontaneityScore: 82,
    crowdLabel: "Low-key",
    tags: ["Storytelling", "Community", "Live music"],
  },
  {
    id: "6",
    title: "Victorian Masters Track and Field Championship",
    venue: "Doncaster Athletics Track",
    timeLabel: "Sat 14 Mar, 8:00 AM onwards",
    photoUrl:
      "https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=420&q=80",
    sourceUrl:
      "https://vicmastersaths.org.au/event/2026-victorian-masters-track-and-field-championship-march-14-and-15th/",
    location: [-37.7878, 145.1299],
    category: "fitness",
    spontaneityScore: 58,
    crowdLabel: "Good vibe",
    tags: ["Athletics", "Track and field", "Masters"],
  },
  {
    id: "7",
    title: "Victorian Owners and Breeders Race Day",
    venue: "Caulfield Racecourse",
    timeLabel: "Sat 14 Mar, race-day schedule",
    photoUrl:
      "https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?auto=format&fit=crop&w=420&q=80",
    sourceUrl:
      "https://mrc.racing.com/calendar/caulfield-victorian-owners-and-breeders-race-day",
    location: [-37.8822, 145.0421],
    category: "social",
    spontaneityScore: 75,
    crowdLabel: "Packed",
    tags: ["Horse racing", "Race day", "Caulfield"],
  },
  {
    id: "8",
    title: "Petting Zoo at Marnong Estate",
    venue: "Marnong Estate, Mickleham",
    timeLabel: "Sun 15 Mar, 11:00 AM - 2:00 PM",
    photoUrl:
      "https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=420&q=80",
    sourceUrl: "https://marnongestate.com.au/calendar/petting-zoo/",
    location: [-37.5428, 144.8744],
    category: "social",
    spontaneityScore: 80,
    crowdLabel: "Good vibe",
    tags: ["Family", "Animals", "Weekend"],
  },
  {
    id: "9",
    title: "Learn to Play Pokemon at TGX",
    venue: "MCEC, South Wharf",
    timeLabel: "Sun 15 Mar, 11:00 AM",
    photoUrl:
      "https://images.unsplash.com/photo-1613771404784-3a5686aa2be3?auto=format&fit=crop&w=420&q=80",
    sourceUrl:
      "https://www.ozziecollectables.com/products/learn-to-play-pokemon-at-tgx-melbourne-2026-sunday-15th-march-11am",
    location: [-37.8242, 144.9561],
    category: "social",
    spontaneityScore: 92,
    crowdLabel: "Good vibe",
    tags: ["Pokemon", "Beginner friendly", "Cards"],
  },
  {
    id: "10",
    title: "Magnolia Park Live in Melbourne",
    venue: "Stay Gold, Brunswick",
    timeLabel: "Sun 15 Mar, 7:30 PM",
    photoUrl:
      "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=420&q=80",
    sourceUrl: "https://oztix.link/153e9kg",
    location: [-37.7663, 144.9626],
    category: "music",
    spontaneityScore: 77,
    crowdLabel: "Packed",
    tags: ["Live music", "Brunswick", "Rock"],
  },
  {
    id: "11",
    title: "Dome Promenade Tours",
    venue: "Royal Exhibition Building, Carlton",
    timeLabel: "Sun 15 Mar, scheduled tours",
    photoUrl:
      "https://images.unsplash.com/photo-1516483638261-f4dbaf036963?auto=format&fit=crop&w=420&q=80",
    sourceUrl: "https://www.whitehat.com.au/DatesM/03March/15.aspx",
    location: [-37.8046, 144.9718],
    category: "arts",
    spontaneityScore: 79,
    crowdLabel: "Low-key",
    tags: ["Architecture", "City views", "Guided tour"],
  },
  {
    id: "12",
    title: "Monash Connects - International Women's Day",
    venue: "Monash Council Civic Centre, Glen Waverley",
    timeLabel: "Wed 11 Mar, 6:30 PM - 8:30 PM",
    photoUrl:
      "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&w=420&q=80",
    sourceUrl: "https://www.trybooking.com/events/landing/1524539",
    location: [-37.8787, 145.1658],
    category: "social",
    spontaneityScore: 72,
    crowdLabel: "Good vibe",
    tags: ["IWD", "Panel", "Community"],
  },
  {
    id: "13",
    title: "Skyline Melbourne Ferris Wheel",
    venue: "South Wharf Promenade",
    timeLabel: "Operating this week",
    photoUrl:
      "https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=420&q=80",
    sourceUrl: "https://www.mcec.com.au/whats-on/2024/05/skyline-melbourne-ferris-wheel",
    location: [-37.8251, 144.9536],
    category: "social",
    spontaneityScore: 91,
    crowdLabel: "Good vibe",
    tags: ["Ferris wheel", "South Wharf", "Views"],
  },
  {
    id: "14",
    title: "The Great Clothing Exchange",
    venue: "City of Monash (see council listing)",
    timeLabel: "Sun 15 Mar, daytime",
    photoUrl:
      "https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=420&q=80",
    sourceUrl: "https://www.monash.vic.gov.au/Home/Tabs/Upcoming-Events",
    location: [-37.8771, 145.1639],
    category: "social",
    spontaneityScore: 87,
    crowdLabel: "Good vibe",
    tags: ["Sustainability", "Swap", "Community"],
  },
  {
    id: "15",
    title: "Business Plan Accelerator Workshop",
    venue: "City of Monash business events",
    timeLabel: "Tue 17 Mar - Wed 18 Mar",
    photoUrl:
      "https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=420&q=80",
    sourceUrl: "https://www.monash.vic.gov.au/Business/Business-Events",
    location: [-37.8787, 145.1658],
    category: "social",
    spontaneityScore: 60,
    crowdLabel: "Low-key",
    tags: ["Business", "Workshop", "Startup"],
  },
  {
    id: "16",
    title: "Formula 1 - The Exhibition Melbourne",
    venue: "MCEC, South Wharf",
    timeLabel: "Open this week (until 19 Apr)",
    photoUrl:
      "https://images.unsplash.com/photo-1541773367336-d14d07e7f5d6?auto=format&fit=crop&w=420&q=80",
    sourceUrl: "https://www.mcec.com.au/whats-on/2025/11/f1-exhibition",
    location: [-37.8242, 144.9561],
    category: "arts",
    spontaneityScore: 86,
    crowdLabel: "Packed",
    tags: ["Formula 1", "Exhibition", "Sports culture"],
  },
  {
    id: "17",
    title: "WARNE: Treasures of a Legend",
    venue: "Australian Sports Museum, MCG",
    timeLabel: "Open this week",
    photoUrl:
      "https://images.unsplash.com/photo-1624880357913-a8539238245b?auto=format&fit=crop&w=420&q=80",
    sourceUrl:
      "https://www.melbourning.com.au/2026/03/09/whats-on-in-melbourne-and-regional-victoria-this-week-9-15-march-2026/",
    location: [-37.8186, 144.9834],
    category: "arts",
    spontaneityScore: 90,
    crowdLabel: "Good vibe",
    tags: ["Cricket", "Museum", "Shane Warne"],
  },
  {
    id: "18",
    title: "Play School: Come and Play!",
    venue: "ACMI, Federation Square",
    timeLabel: "Open this week",
    photoUrl:
      "https://images.unsplash.com/photo-1516627145497-ae6968895b74?auto=format&fit=crop&w=420&q=80",
    sourceUrl:
      "https://www.melbourning.com.au/2026/03/09/whats-on-in-melbourne-and-regional-victoria-this-week-9-15-march-2026/",
    location: [-37.8175, 144.9680],
    category: "arts",
    spontaneityScore: 88,
    crowdLabel: "Good vibe",
    tags: ["Family", "Interactive", "Exhibition"],
  },
  {
    id: "19",
    title: "Game Worlds",
    venue: "ACMI, Federation Square",
    timeLabel: "Open this week",
    photoUrl:
      "https://images.unsplash.com/photo-1552820728-8b83bb6b773f?auto=format&fit=crop&w=420&q=80",
    sourceUrl:
      "https://www.melbourning.com.au/2026/03/09/whats-on-in-melbourne-and-regional-victoria-this-week-9-15-march-2026/",
    location: [-37.8175, 144.9680],
    category: "arts",
    spontaneityScore: 89,
    crowdLabel: "Good vibe",
    tags: ["Games", "Interactive", "Digital culture"],
  },
  {
    id: "20",
    title: "Balloon Story Melbourne",
    venue: "MCEC, South Wharf",
    timeLabel: "Open this week",
    photoUrl:
      "https://images.unsplash.com/photo-1521336575822-6da63fb45455?auto=format&fit=crop&w=420&q=80",
    sourceUrl: "https://www.mcec.com.au/whats-on/2026/01/balloon-story-melbourne",
    location: [-37.8242, 144.9561],
    category: "arts",
    spontaneityScore: 87,
    crowdLabel: "Good vibe",
    tags: ["Immersive", "Family", "Exhibition"],
  },
];
