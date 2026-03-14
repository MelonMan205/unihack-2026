"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { type ReactNode, useEffect, useMemo, useState, useTransition } from "react";
import {
  Dumbbell,
  Grid2x2,
  MapPin,
  Palette,
  Search,
  Timer,
  UtensilsCrossed,
  Users2,
  Waves,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { fetchEventsFromSupabase } from "@/lib/supabase-events";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { DEFAULT_LOCATION, MOCK_EVENTS, type Category, type EventPin } from "@/mock/events";
import { distanceInKm } from "@/utils/geo";

const MapView = dynamic(() => import("@/components/MapView").then((mod) => mod.MapView), {
  ssr: false,
});

const FILTERS: { label: string; value: Category | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Music", value: "music" },
  { label: "Food", value: "food" },
  { label: "Fitness", value: "fitness" },
  { label: "Social", value: "social" },
  { label: "Arts", value: "arts" },
];

const HERO_RADIUS_KM = 1;
const EVENTS_POLL_INTERVAL_MS = 30_000;
const EVENT_CACHE_KEY = "haps-live-events-v1";

const categoryIcons: Record<Category, ReactNode> = {
  music: <Waves className="h-[16px] w-[16px] stroke-[1.85]" />,
  food: <UtensilsCrossed className="h-[16px] w-[16px] stroke-[1.85]" />,
  fitness: <Dumbbell className="h-[16px] w-[16px] stroke-[1.85]" />,
  social: <Users2 className="h-[16px] w-[16px] stroke-[1.85]" />,
  arts: <Palette className="h-[16px] w-[16px] stroke-[1.85]" />,
};

function mergeLiveAndMockEvents(liveEvents: EventPin[]): EventPin[] {
  const allEvents = [...liveEvents, ...MOCK_EVENTS];
  const seen = new Set<string>();

  return allEvents.filter((event) => {
    const identity = event.sourceUrl ?? `${event.title}-${event.venue}-${event.timeLabel}`;
    if (seen.has(identity)) {
      return false;
    }
    seen.add(identity);
    return true;
  });
}

function areEventListsEqual(left: EventPin[], right: EventPin[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftEvent = left[index];
    const rightEvent = right[index];
    if (
      leftEvent.id !== rightEvent.id ||
      leftEvent.title !== rightEvent.title ||
      leftEvent.timeLabel !== rightEvent.timeLabel ||
      leftEvent.venue !== rightEvent.venue
    ) {
      return false;
    }
  }

  return true;
}

export default function HomePage() {
  const [selectedCategory, setSelectedCategory] = useState<Category | "all">("all");
  const [selectedEvent, setSelectedEvent] = useState<EventPin | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [events, setEvents] = useState<EventPin[]>(MOCK_EVENTS);
  const [userLocation, setUserLocation] = useState<[number, number]>(DEFAULT_LOCATION);
  const [locationLabel, setLocationLabel] = useState("Locating you...");
  const [isLocationReady, setIsLocationReady] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    try {
      const rawValue = window.localStorage.getItem(EVENT_CACHE_KEY);
      if (!rawValue) {
        return;
      }

      const cachedEvents = JSON.parse(rawValue) as EventPin[];
      if (!Array.isArray(cachedEvents) || cachedEvents.length === 0) {
        return;
      }

      setEvents((currentEvents) => {
        const merged = mergeLiveAndMockEvents(cachedEvents);
        return areEventListsEqual(currentEvents, merged) ? currentEvents : merged;
      });
    } catch {
      // Ignore invalid cache payloads.
    }
  }, []);

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setUserLocation(DEFAULT_LOCATION);
      setLocationLabel("Melbourne fallback");
      setIsLocationReady(true);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation([position.coords.latitude, position.coords.longitude]);
        setLocationLabel("Near you now");
        setIsLocationReady(true);
      },
      () => {
        setUserLocation(DEFAULT_LOCATION);
        setLocationLabel("Using Melbourne fallback");
        setIsLocationReady(true);
      },
      { enableHighAccuracy: true, timeout: 7000 },
    );
  }, []);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client) {
      return;
    }

    let isDisposed = false;
    let isRequestInFlight = false;

    const pollEvents = async () => {
      if (isDisposed || isRequestInFlight) {
        return;
      }

      isRequestInFlight = true;

      try {
        const supabaseEvents = await fetchEventsFromSupabase(client);
        if (!isDisposed) {
          const mergedEvents = mergeLiveAndMockEvents(supabaseEvents);
          try {
            window.localStorage.setItem(EVENT_CACHE_KEY, JSON.stringify(supabaseEvents));
          } catch {
            // Ignore storage limits and continue.
          }

          startTransition(() => {
            setEvents((currentEvents) =>
              areEventListsEqual(currentEvents, mergedEvents) ? currentEvents : mergedEvents,
            );
          });
        }
      } catch (error) {
        console.error("[events-poll] failed to load events", error);
      } finally {
        isRequestInFlight = false;
      }
    };

    void pollEvents();

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void pollEvents();
      }
    }, EVENTS_POLL_INTERVAL_MS);

    const onFocus = () => void pollEvents();
    window.addEventListener("focus", onFocus);

    return () => {
      isDisposed = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const categoryFilteredEvents = useMemo(
    () =>
      selectedCategory === "all"
        ? events
        : events.filter((event) => event.category === selectedCategory),
    [selectedCategory, events],
  );

  const filteredEvents = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return categoryFilteredEvents;
    }

    const matches = categoryFilteredEvents.filter((event) => {
      const haystack = `${event.title} ${event.venue} ${event.tags.join(" ")} ${event.category}`.toLowerCase();
      return haystack.includes(query);
    });
    return matches.length > 0 ? matches : categoryFilteredEvents;
  }, [categoryFilteredEvents, searchQuery]);

  const nearbyTonightCount = useMemo(
    () =>
      filteredEvents.filter((event) => distanceInKm(event.location, userLocation) <= HERO_RADIUS_KM).length,
    [filteredEvents, userLocation],
  );

  return (
    <main className="relative h-[100dvh] min-h-[100svh] w-full overflow-hidden bg-[#eef1f5] text-zinc-900">
      {isLocationReady ? (
        <MapView
          events={filteredEvents}
          onSelectEvent={(event) => setSelectedEvent(event)}
          userLocation={userLocation}
        />
      ) : (
        <div className="h-[100dvh] min-h-[100svh] w-full bg-[#f8f3e8]" />
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 z-[1200] pt-[max(0.75rem,env(safe-area-inset-top))] sm:pt-4">
        <div className="mx-auto w-full max-w-4xl px-3 sm:px-4">
          <Card className="glass-panel pointer-events-auto w-full border-white/30 text-zinc-900 animate-rise">
            <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-5">
              <div>
                <p className="text-[10px] uppercase tracking-[0.24em] text-zinc-500 sm:text-[11px]">
                  Tonight nearby
                </p>
                <h1 className="text-[15px] font-semibold leading-tight text-zinc-900 sm:text-2xl">
                  {nearbyTonightCount} spontaneous things within {HERO_RADIUS_KM}km tonight
                </h1>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="glass-badge bg-white/65 text-zinc-700">
                  <MapPin className="mr-1.5 h-3.5 w-3.5 text-yellow-500" />
                  {locationLabel}
                </Badge>
                <Badge variant="secondary" className="glass-badge bg-yellow-200/70 text-zinc-900">
                  <Timer className="mr-1.5 h-3.5 w-3.5" />
                  Live now
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="pointer-events-none absolute left-4 top-1/2 z-[1200] hidden -translate-y-1/2 lg:block">
        <div className="glass-panel flex w-[68px] flex-col items-center gap-2 rounded-[20px] p-2">
          {FILTERS.map((filter) => (
            <Button
              key={filter.value}
              variant={selectedCategory === filter.value ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedCategory(filter.value)}
              className={`icon-filter-btn pointer-events-auto h-11 w-11 rounded-[14px] px-0 ${
                selectedCategory === filter.value ? "icon-filter-btn--active" : ""
              }`}
              aria-label={filter.label}
              title={filter.label}
            >
              {filter.value === "all" ? (
                <Grid2x2 className="h-[16px] w-[16px] stroke-[1.85]" />
              ) : (
                categoryIcons[filter.value]
              )}
            </Button>
          ))}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1200] pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-4">
        <div className="mx-auto w-full max-w-4xl px-3 sm:px-4">
          <Card className="glass-panel pointer-events-auto w-full border-white/30 animate-rise-delayed">
            <CardContent className="flex flex-col gap-3 p-3 sm:p-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="no-scrollbar flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 lg:hidden">
                {FILTERS.map((filter) => (
                  <Button
                    key={filter.value}
                    variant={selectedCategory === filter.value ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedCategory(filter.value)}
                    className={`icon-filter-btn h-10 snap-start px-4 ${
                      selectedCategory === filter.value ? "icon-filter-btn--active" : ""
                    }`}
                  >
                    {filter.value !== "all" ? categoryIcons[filter.value] : null}
                    {filter.label}
                  </Button>
                ))}
              </div>
              <div className="pointer-events-auto relative min-w-0 flex-1 lg:min-w-[220px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search for anything..."
                  className="h-11 w-full rounded-[14px] border border-zinc-300/70 bg-white/82 pl-9 pr-3 text-sm text-zinc-800 outline-none placeholder:text-zinc-500 focus:border-zinc-400"
                />
              </div>
              <Button className="icon-filter-btn h-11 w-full rounded-[14px] sm:w-auto sm:px-6">
                Go on a side quest
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <Sheet open={Boolean(selectedEvent)} onOpenChange={(open) => !open && setSelectedEvent(null)}>
        <SheetContent
          side="bottom"
          className="mx-auto z-[1400] max-h-[85dvh] max-w-3xl overflow-y-auto rounded-t-[22px] border border-white/85 bg-white/88 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 shadow-[0_30px_80px_rgba(15,23,42,0.35)] backdrop-blur-3xl sm:px-5"
        >
          {selectedEvent ? (
            <>
              <div className="relative mb-4 overflow-hidden rounded-2xl border border-white/90 bg-zinc-100/60 shadow-[0_16px_28px_rgba(15,23,42,0.2)]">
                <Image
                  src={selectedEvent.photoUrl}
                  alt={selectedEvent.title}
                  width={1200}
                  height={640}
                  className="h-44 w-full object-cover sm:h-56"
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-zinc-900/35 via-zinc-900/10 to-transparent" />
              </div>
              <SheetHeader>
                <SheetTitle className="text-xl text-zinc-900">{selectedEvent.title}</SheetTitle>
                <SheetDescription>{selectedEvent.venue}</SheetDescription>
              </SheetHeader>

              <p className="mt-3 text-sm leading-relaxed text-zinc-700">
                {selectedEvent.description?.trim() ||
                  `Drop in for a ${selectedEvent.category} experience at ${selectedEvent.venue}.`}
              </p>

              <div className="mt-5 flex flex-wrap items-center gap-2">
                <Badge className="bg-yellow-400 text-zinc-900">{selectedEvent.timeLabel}</Badge>
                <Badge variant="secondary" className="bg-white/75 text-zinc-700">
                  {distanceInKm(selectedEvent.location, userLocation).toFixed(1)} km away
                </Badge>
                <Badge variant="secondary" className="bg-white/75 text-zinc-700">
                  Spontaneity {selectedEvent.spontaneityScore}/100
                </Badge>
                <Badge variant="secondary" className="bg-white/75 text-zinc-700">
                  {selectedEvent.crowdLabel}
                </Badge>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {selectedEvent.tags.map((tag) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </div>

              <Button className="mt-6 h-11 w-full bg-yellow-400 text-zinc-900 hover:bg-yellow-300">
                Go now
              </Button>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </main>
  );
}
