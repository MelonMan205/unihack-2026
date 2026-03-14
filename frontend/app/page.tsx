"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import {
  Crosshair,
  Dumbbell,
  Grid2x2,
  MapPin,
  Palette,
  Search,
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
import { DEFAULT_LOCATION, type Category, type EventPin } from "@/mock/events";
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

type TimeWindow = "tonight" | "today" | "any";

const DEFAULT_RADIUS_KM = 1;
const MIN_RADIUS_KM = 0.5;
const MAX_RADIUS_KM = 20;
const RADIUS_STEP_KM = 0.5;
const EVENTS_POLL_INTERVAL_MS = 30_000;
const EVENT_CACHE_KEY = "haps-live-events-v1";
const TIME_WINDOWS: TimeWindow[] = ["tonight", "today", "any"];

const categoryIcons: Record<Category, ReactNode> = {
  music: <Waves className="h-[16px] w-[16px] stroke-[1.85]" />,
  food: <UtensilsCrossed className="h-[16px] w-[16px] stroke-[1.85]" />,
  fitness: <Dumbbell className="h-[16px] w-[16px] stroke-[1.85]" />,
  social: <Users2 className="h-[16px] w-[16px] stroke-[1.85]" />,
  arts: <Palette className="h-[16px] w-[16px] stroke-[1.85]" />,
};

function mergeLiveAndMockEvents(liveEvents: EventPin[]): EventPin[] {
  const allEvents = [...liveEvents];
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

function formatRadiusLabel(radiusKm: number): string {
  const rounded = Number.isInteger(radiusKm) ? radiusKm.toFixed(0) : radiusKm.toFixed(1);
  return `${rounded}km`;
}

function formatTimeWindowLabel(timeWindow: TimeWindow): string {
  if (timeWindow === "today") {
    return "today";
  }
  if (timeWindow === "any") {
    return "anytime";
  }
  return "tonight";
}

function toTwentyFourHour(hourText: string, suffixText: string): number {
  const hour = Number.parseInt(hourText, 10);
  const suffix = suffixText.toLowerCase();
  if (suffix === "am") {
    return hour % 12;
  }
  return hour % 12 === 0 ? 12 : hour + 12;
}

function getFirstHourFromTimeLabel(label: string): number | null {
  const match = label.match(/(\d{1,2})(?::\d{2})?\s*(am|pm)/i);
  if (!match) {
    return null;
  }
  return toTwentyFourHour(match[1], match[2]);
}

function isTodayLabel(label: string, now: Date): boolean {
  const normalized = label.toLowerCase();
  const weekday = new Intl.DateTimeFormat("en-AU", { weekday: "short" }).format(now).toLowerCase();
  const month = new Intl.DateTimeFormat("en-AU", { month: "short" }).format(now).toLowerCase();
  const day = String(now.getDate());
  return (
    normalized.includes("today") ||
    normalized.includes("tonight") ||
    normalized.includes(weekday) ||
    normalized.includes(`${day} ${month}`)
  );
}

function matchesTimeWindow(timeLabel: string, timeWindow: TimeWindow, now: Date): boolean {
  if (timeWindow === "any") {
    return true;
  }

  const normalized = timeLabel.toLowerCase();
  const hasLooseScheduleToken =
    normalized.includes("open this week") ||
    normalized.includes("operating this week") ||
    normalized.includes("scheduled tours") ||
    normalized.includes("daytime") ||
    normalized.includes("race-day") ||
    normalized.includes("onwards");

  if (timeWindow === "today") {
    return isTodayLabel(timeLabel, now) || hasLooseScheduleToken;
  }

  if (normalized.includes("tonight")) {
    return true;
  }

  if (!isTodayLabel(timeLabel, now)) {
    return false;
  }

  const hour = getFirstHourFromTimeLabel(timeLabel);
  if (hour !== null) {
    return hour >= 17;
  }

  return normalized.includes("pm") || normalized.includes("evening") || normalized.includes("night");
}

export default function HomePage() {
  const [selectedCategory, setSelectedCategory] = useState<Category | "all">("all");
  const [selectedEvent, setSelectedEvent] = useState<EventPin | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [radiusKm, setRadiusKm] = useState(DEFAULT_RADIUS_KM);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("tonight");
  const [openDiscoverControl, setOpenDiscoverControl] = useState<"radius" | "time" | null>(null);
  const [locationMode, setLocationMode] = useState<"current" | "pick">("current");
  const [events, setEvents] = useState<EventPin[]>([]);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [attendanceByEventId, setAttendanceByEventId] = useState<Record<string, string>>({});
  const [attendanceVisibilityByEventId, setAttendanceVisibilityByEventId] = useState<Record<string, string>>({});
  const [savedEventIds, setSavedEventIds] = useState<Set<string>>(new Set());
  const [userLocation, setUserLocation] = useState<[number, number]>(DEFAULT_LOCATION);
  const [locationLabel, setLocationLabel] = useState("locating you...");
  const [isLocationReady, setIsLocationReady] = useState(false);
  const [, startTransition] = useTransition();

  const syncCurrentLocation = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setUserLocation(DEFAULT_LOCATION);
      setLocationLabel("melbourne fallback");
      setIsLocationReady(true);
      return;
    }

    setLocationLabel("locating you...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation([position.coords.latitude, position.coords.longitude]);
        setLocationLabel("near you now");
        setIsLocationReady(true);
      },
      () => {
        setUserLocation(DEFAULT_LOCATION);
        setLocationLabel("using melbourne fallback");
        setIsLocationReady(true);
      },
      { enableHighAccuracy: true, timeout: 7000 },
    );
  }, []);

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
    const client = getSupabaseBrowserClient();
    if (!client) return;

    client.auth.getUser().then(({ data }) => {
      setAuthUserId(data.user?.id ?? null);
    });
  }, []);

  useEffect(() => {
    syncCurrentLocation();
  }, [syncCurrentLocation]);

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

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client || !authUserId) {
      return;
    }

    client
      .from("event_attendance")
      .select("event_id,status,visibility")
      .eq("user_id", authUserId)
      .then(({ data }) => {
        const nextStatuses: Record<string, string> = {};
        const nextVisibility: Record<string, string> = {};
        for (const row of data ?? []) {
          nextStatuses[row.event_id] = row.status;
          nextVisibility[row.event_id] = row.visibility;
        }
        setAttendanceByEventId(nextStatuses);
        setAttendanceVisibilityByEventId(nextVisibility);
      });

    client
      .from("saved_event_items")
      .select("event_id")
      .eq("user_id", authUserId)
      .then(({ data }) => {
        setSavedEventIds(new Set((data ?? []).map((row) => row.event_id)));
      });
  }, [authUserId]);

  const setAttendance = async (
    eventId: string,
    status: "interested" | "going" | "not_going" | "checked_in",
    visibility: "public" | "friends" | "close_friends" | "only_me" | "ghost" = "friends",
  ) => {
    const client = getSupabaseBrowserClient();
    if (!client || !authUserId) {
      alert("Please sign in first.");
      return;
    }
    const { error } = await client.rpc("app_set_attendance", {
      event_uuid: eventId,
      attendance_status: status,
      visibility_mode: visibility,
    });
    if (error) {
      alert(error.message);
      return;
    }
    setAttendanceByEventId((current) => ({ ...current, [eventId]: status }));
    setAttendanceVisibilityByEventId((current) => ({ ...current, [eventId]: visibility }));
  };

  const toggleSave = async (eventId: string) => {
    const client = getSupabaseBrowserClient();
    if (!client || !authUserId) {
      alert("Please sign in first.");
      return;
    }

    const { data: collections } = await client
      .from("saved_event_collections")
      .select("id")
      .eq("user_id", authUserId)
      .eq("is_default", true)
      .limit(1);

    let collectionId = collections?.[0]?.id;
    if (!collectionId) {
      const { data: created, error: createError } = await client
        .from("saved_event_collections")
        .insert({ user_id: authUserId, name: "Saved Events", is_default: true })
        .select("id")
        .single();
      if (createError || !created) {
        alert(createError?.message ?? "Failed to create default collection.");
        return;
      }
      collectionId = created.id;
    }

    if (savedEventIds.has(eventId)) {
      const { error } = await client
        .from("saved_event_items")
        .delete()
        .eq("user_id", authUserId)
        .eq("event_id", eventId)
        .eq("collection_id", collectionId);
      if (error) {
        alert(error.message);
        return;
      }
      setSavedEventIds((current) => {
        const next = new Set(current);
        next.delete(eventId);
        return next;
      });
      return;
    }

    const { error } = await client.from("saved_event_items").insert({
      user_id: authUserId,
      event_id: eventId,
      collection_id: collectionId,
    });
    if (error) {
      alert(error.message);
      return;
    }
    setSavedEventIds((current) => new Set(current).add(eventId));
  };

  const checkInToEvent = async (eventId: string) => {
    const client = getSupabaseBrowserClient();
    if (!client || !authUserId) {
      alert("Please sign in first.");
      return;
    }
    const { error } = await client.rpc("app_check_in", { event_uuid: eventId, ttl_minutes: 240 });
    if (error) {
      alert(error.message);
      return;
    }
    setAttendanceByEventId((current) => ({ ...current, [eventId]: "checked_in" }));
  };

  const categoryFilteredEvents = useMemo(
    () =>
      selectedCategory === "all"
        ? events
        : events.filter((event) => event.category === selectedCategory),
    [selectedCategory, events],
  );

  const searchedEvents = useMemo(() => {
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

  const now = useMemo(() => new Date(), []);
  const timeWindowIndex = TIME_WINDOWS.indexOf(timeWindow);
  const radiusSliderProgress = ((radiusKm - MIN_RADIUS_KM) / (MAX_RADIUS_KM - MIN_RADIUS_KM)) * 100;
  const timeSliderProgress = (timeWindowIndex / (TIME_WINDOWS.length - 1)) * 100;
  const filteredEvents = useMemo(
    () =>
      searchedEvents.filter((event) => {
        const withinRadius = distanceInKm(event.location, userLocation) <= radiusKm;
        if (!withinRadius) {
          return false;
        }
        return matchesTimeWindow(event.timeLabel, timeWindow, now);
      }),
    [searchedEvents, userLocation, radiusKm, timeWindow, now],
  );

  return (
    <main className="relative h-[100dvh] min-h-[100svh] w-full overflow-hidden bg-[#eef1f5] text-zinc-900">
      {isLocationReady ? (
        <MapView
          events={filteredEvents}
          onSelectEvent={(event) => setSelectedEvent(event)}
          userLocation={userLocation}
          radiusKm={radiusKm}
          isPickingLocation={locationMode === "pick"}
          onPickLocation={(location) => {
            if (locationMode !== "pick") {
              return;
            }
            setUserLocation(location);
            setLocationLabel("pinned location");
            setIsLocationReady(true);
          }}
        />
      ) : (
        <div className="h-[100dvh] min-h-[100svh] w-full bg-[#f8f3e8]" />
      )}

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
            <CardContent className="flex flex-col gap-3 p-3 pt-4 sm:p-4 sm:pt-5">
              <div className="flex flex-col gap-2 pt-0.5 sm:flex-row sm:items-start sm:justify-between">
                <div className="pointer-events-auto max-w-full overflow-x-auto no-scrollbar">
                  <p className="inline-flex items-center gap-1 whitespace-nowrap text-[16px] font-semibold text-zinc-900 sm:text-[17px]">
                    <span>{filteredEvents.length}</span>
                    <span>spontaneous things within</span>
                    <button
                      type="button"
                      onClick={() =>
                        setOpenDiscoverControl((current) => (current === "radius" ? null : "radius"))
                      }
                      className={`discover-inline-chip ${
                        openDiscoverControl === "radius" ? "discover-inline-chip--active" : ""
                      }`}
                    >
                      {formatRadiusLabel(radiusKm)}
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpenDiscoverControl((current) => (current === "time" ? null : "time"))}
                      className={`discover-inline-chip ${
                        openDiscoverControl === "time" ? "discover-inline-chip--active" : ""
                      }`}
                    >
                      {formatTimeWindowLabel(timeWindow)}
                    </button>
                  </p>
                </div>

                <div className="pointer-events-auto flex items-center gap-2">
                  <Button
                    type="button"
                    variant={locationMode === "current" ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setLocationMode("current");
                      syncCurrentLocation();
                    }}
                    className={`icon-filter-btn h-9 rounded-[12px] px-3 text-xs ${
                      locationMode === "current" ? "icon-filter-btn--active" : ""
                    }`}
                  >
                    <MapPin className="mr-1.5 h-3.5 w-3.5" />
                      current
                  </Button>
                  <Button
                    type="button"
                    variant={locationMode === "pick" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setLocationMode("pick")}
                    className={`icon-filter-btn h-9 rounded-[12px] px-3 text-xs ${
                      locationMode === "pick" ? "icon-filter-btn--active" : ""
                    }`}
                  >
                    <Crosshair className="mr-1.5 h-3.5 w-3.5" />
                      pick
                  </Button>
                </div>
              </div>

              {openDiscoverControl === "radius" ? (
                <div className="pointer-events-auto discover-control-panel">
                  <div className="discover-control-panel__head">
                    <span className="discover-control-panel__title">range</span>
                    <span className="discover-control-panel__value">{formatRadiusLabel(radiusKm)}</span>
                  </div>
                  <input
                    type="range"
                    min={MIN_RADIUS_KM}
                    max={MAX_RADIUS_KM}
                    step={RADIUS_STEP_KM}
                    value={radiusKm}
                    onChange={(event) => setRadiusKm(Number(event.target.value))}
                    className="discover-slider"
                    style={{ "--slider-progress": `${radiusSliderProgress}%` } as CSSProperties}
                    aria-label="Search radius"
                  />
                </div>
              ) : null}

              {openDiscoverControl === "time" ? (
                <div className="pointer-events-auto discover-control-panel">
                  <div className="discover-control-panel__head">
                    <span className="discover-control-panel__title">time window</span>
                    <span className="discover-control-panel__value">{formatTimeWindowLabel(timeWindow)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={TIME_WINDOWS.length - 1}
                    step={1}
                    value={timeWindowIndex}
                    onChange={(event) => {
                      const index = Number(event.target.value);
                      const nextWindow = TIME_WINDOWS[index] ?? "tonight";
                      setTimeWindow(nextWindow);
                    }}
                    className="discover-slider"
                    style={{ "--slider-progress": `${timeSliderProgress}%` } as CSSProperties}
                    aria-label="Event time window"
                  />
                  <div className="discover-slider-labels">
                    <span>tonight</span>
                    <span>today</span>
                    <span>anytime</span>
                  </div>
                </div>
              ) : null}

              <div className="pointer-events-auto">
                <Badge variant="secondary" className="glass-badge bg-white/65 text-zinc-700">
                  {locationLabel}
                </Badge>
                {locationMode === "pick" ? (
                  <p className="mt-1.5 text-[11px] text-zinc-600">pick mode: tap anywhere on the map to pin.</p>
                ) : null}
              </div>

              <div className="no-scrollbar flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 pt-1 lg:hidden">
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
                    {filter.label.toLowerCase()}
                  </Button>
                ))}
              </div>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="pointer-events-auto relative min-w-0 flex-1 lg:min-w-[220px]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="search for anything..."
                    className="h-11 w-full rounded-[14px] border border-zinc-300/70 bg-white/82 pl-9 pr-3 text-sm text-zinc-800 outline-none placeholder:text-zinc-500 focus:border-zinc-400"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {authUserId ? (
                    <>
                      <Link href="/profile/settings" className="icon-filter-btn h-11 rounded-[14px] border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-700">
                        profile
                      </Link>
                      <Link href="/friends" className="icon-filter-btn h-11 rounded-[14px] border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-700">
                        friends
                      </Link>
                      <Link href="/saved" className="icon-filter-btn h-11 rounded-[14px] border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-700">
                        saved
                      </Link>
                    </>
                  ) : (
                    <Link href="/auth" className="icon-filter-btn h-11 rounded-[14px] border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-700">
                      sign in
                    </Link>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Sheet open={Boolean(selectedEvent)} onOpenChange={(open) => !open && setSelectedEvent(null)}>
        <SheetContent
          side="bottom"
          className="mx-auto z-[1400] max-h-[85dvh] max-w-3xl overflow-y-auto rounded-t-[22px] border border-white/85 bg-white/88 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-12 shadow-[0_30px_80px_rgba(15,23,42,0.35)] backdrop-blur-3xl sm:px-5"
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

              <div className="mt-6 grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  onClick={() => void setAttendance(selectedEvent.id, "interested", "friends")}
                  className="h-10 bg-white text-zinc-900 hover:bg-zinc-100"
                >
                  Interested
                </Button>
                <Button
                  type="button"
                  onClick={() => void setAttendance(selectedEvent.id, "going", "friends")}
                  className="h-10 bg-yellow-400 text-zinc-900 hover:bg-yellow-300"
                >
                  Going
                </Button>
                <Button
                  type="button"
                  onClick={() => void setAttendance(selectedEvent.id, "not_going", "only_me")}
                  className="h-10 bg-white text-zinc-900 hover:bg-zinc-100"
                >
                  Not Going
                </Button>
                <Button
                  type="button"
                  onClick={() => void setAttendance(selectedEvent.id, "going", "ghost")}
                  className="h-10 bg-white text-zinc-900 hover:bg-zinc-100"
                >
                  Ghost Mode
                </Button>
                <Button
                  type="button"
                  onClick={() => void checkInToEvent(selectedEvent.id)}
                  className="h-10 bg-white text-zinc-900 hover:bg-zinc-100"
                >
                  Check in
                </Button>
                <Button
                  type="button"
                  onClick={() => void toggleSave(selectedEvent.id)}
                  className="h-10 bg-white text-zinc-900 hover:bg-zinc-100"
                >
                  {savedEventIds.has(selectedEvent.id) ? "Unsave" : "Save"}
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    if (selectedEvent.sourceUrl) {
                      void navigator.clipboard.writeText(selectedEvent.sourceUrl);
                      alert("Event link copied.");
                    }
                  }}
                  className="h-10 bg-white text-zinc-900 hover:bg-zinc-100"
                >
                  Share link
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-600">
                <span>Status: {attendanceByEventId[selectedEvent.id] ?? "none"}</span>
                <span>Visibility: {attendanceVisibilityByEventId[selectedEvent.id] ?? "friends"}</span>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </main>
  );
}
