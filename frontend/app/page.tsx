"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  Crosshair,
  ExternalLink,
  MapPin,
  Search,
  Sparkles,
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

type TimeWindow = "3h" | "12h" | "1d" | "3d" | "1w" | "any";
type DiscoveryMode = "recommended" | "all";
type SportsFilter = "all" | "sports_only";
type AlcoholFilter = "all" | "alcoholic" | "non_alcoholic";
type PriceFilter = "all" | "free" | "budget" | "mid" | "premium";
type Viewport = { north: number; south: number; east: number; west: number; zoom: number };

const DEFAULT_RADIUS_KM = 1;
const MIN_RADIUS_KM = 0.5;
const MAX_RADIUS_KM = 20;
const RADIUS_STEP_KM = 0.5;
const EVENTS_POLL_INTERVAL_MS = 30_000;
const EVENT_CACHE_KEY = "haps-live-events-v1";
const TIME_WINDOWS: TimeWindow[] = ["3h", "12h", "1d", "3d", "1w", "any"];
const FEATURE_FLAGS = {
  friendAttendanceOverlay: true,
  recommendedMode: true,
  viewportQueryMode: true,
} as const;

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
  if (timeWindow === "any") return "anytime";
  if (timeWindow === "1d") return "1 day";
  if (timeWindow === "3d") return "3 days";
  if (timeWindow === "1w") return "1 week";
  return timeWindow;
}

function timeWindowToMs(timeWindow: TimeWindow): number | null {
  if (timeWindow === "3h") return 3 * 60 * 60 * 1000;
  if (timeWindow === "12h") return 12 * 60 * 60 * 1000;
  if (timeWindow === "1d") return 24 * 60 * 60 * 1000;
  if (timeWindow === "3d") return 3 * 24 * 60 * 60 * 1000;
  if (timeWindow === "1w") return 7 * 24 * 60 * 60 * 1000;
  return null;
}

function viewportChangedEnough(previous: Viewport | null, next: Viewport): boolean {
  if (!previous) return true;
  const zoomDiff = Math.abs(previous.zoom - next.zoom);
  const northDiff = Math.abs(previous.north - next.north);
  const southDiff = Math.abs(previous.south - next.south);
  const eastDiff = Math.abs(previous.east - next.east);
  const westDiff = Math.abs(previous.west - next.west);
  return zoomDiff >= 0.4 || northDiff >= 0.01 || southDiff >= 0.01 || eastDiff >= 0.01 || westDiff >= 0.01;
}

function isInsideViewport(location: [number, number], viewport: Viewport): boolean {
  const [lat, lng] = location;
  const latPadding = Math.max((viewport.north - viewport.south) * 0.1, 0.02);
  const lngPadding = Math.max((viewport.east - viewport.west) * 0.1, 0.02);
  return (
    lat <= viewport.north + latPadding &&
    lat >= viewport.south - latPadding &&
    lng <= viewport.east + lngPadding &&
    lng >= viewport.west - lngPadding
  );
}

function scoreEventForInterests(event: EventPin, interests: string[]): number {
  if (interests.length === 0) return 0;
  const normalizedInterests = interests.map((item) => item.toLowerCase());
  const interestSet = new Set(normalizedInterests);
  const tagSet = new Set(event.tags.map((tag) => tag.toLowerCase()));
  for (const subcategory of event.subcategories ?? []) {
    tagSet.add(subcategory.toLowerCase());
  }

  let score = 0;
  for (const interest of interestSet) {
    if (tagSet.has(interest)) score += 3;
    if (event.category.toLowerCase() === interest) score += 2;
    if (interest === "sports" && event.isSports) score += 3;
    if (interest.includes("food") && event.category === "food") score += 2;
    if (interest.includes("music") && event.category === "music") score += 2;
  }
  return score;
}

function matchesLegacyLabelWindow(timeLabel: string, now: Date, targetWindow: TimeWindow): boolean {
  const normalized = timeLabel.toLowerCase();
  if (targetWindow === "any") return true;
  if (targetWindow === "3h" || targetWindow === "12h") {
    if (normalized.includes("today") || normalized.includes("tonight")) {
      const hour = getFirstHourFromTimeLabel(timeLabel);
      if (hour === null) return true;
      const eventDate = new Date(now);
      eventDate.setHours(hour, 0, 0, 0);
      const diffMs = eventDate.getTime() - now.getTime();
      const maxMs = targetWindow === "3h" ? 3 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000;
      return diffMs >= 0 && diffMs <= maxMs;
    }
    return false;
  }
  if (targetWindow === "1d") return isTodayLabel(timeLabel, now);
  if (targetWindow === "3d") return normalized.includes("today") || normalized.includes("tomorrow") || normalized.includes("this week");
  if (targetWindow === "1w") return true;
  return true;
}

function matchesTimeWindow(event: EventPin, timeWindow: TimeWindow, now: Date): boolean {
  const windowMs = timeWindowToMs(timeWindow);
  if (windowMs === null) return true;
  if (event.startAtIso) {
    const eventMs = new Date(event.startAtIso).getTime();
    if (Number.isNaN(eventMs)) {
      return matchesLegacyLabelWindow(event.timeLabel, now, timeWindow);
    }
    const diff = eventMs - now.getTime();
    return diff >= 0 && diff <= windowMs;
  }
  return matchesLegacyLabelWindow(event.timeLabel, now, timeWindow);
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

export default function HomePage() {
  const [selectedCategory, setSelectedCategory] = useState<Category | "all">("all");
  const [discoveryMode, setDiscoveryMode] = useState<DiscoveryMode>("recommended");
  const [selectedEvent, setSelectedEvent] = useState<EventPin | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [radiusKm, setRadiusKm] = useState(DEFAULT_RADIUS_KM);
  const [isRadiusEnabled, setIsRadiusEnabled] = useState(false);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("1d");
  const [sportsFilter, setSportsFilter] = useState<SportsFilter>("all");
  const [alcoholFilter, setAlcoholFilter] = useState<AlcoholFilter>("all");
  const [priceFilter, setPriceFilter] = useState<PriceFilter>("all");
  const [subcategoryFilter, setSubcategoryFilter] = useState("all");
  const [openDiscoverControl, setOpenDiscoverControl] = useState<"radius" | "time" | null>(null);
  const [locationMode, setLocationMode] = useState<"current" | "pick">("current");
  const [events, setEvents] = useState<EventPin[]>([]);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [userInterests, setUserInterests] = useState<string[]>([]);
  const [attendanceByEventId, setAttendanceByEventId] = useState<Record<string, string>>({});
  const [attendanceVisibilityByEventId, setAttendanceVisibilityByEventId] = useState<Record<string, string>>({});
  const [friendAttendanceByEventId, setFriendAttendanceByEventId] = useState<
    Record<
      string,
      Array<{
        user_id: string;
        username: string | null;
        display_name: string | null;
        attendee_position: number;
        total_visible: number;
        is_close_friend: boolean;
      }>
    >
  >({});
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [savedEventIds, setSavedEventIds] = useState<Set<string>>(new Set());
  const [userLocation, setUserLocation] = useState<[number, number]>(DEFAULT_LOCATION);
  const [locationLabel, setLocationLabel] = useState("locating you...");
  const [isLocationReady, setIsLocationReady] = useState(false);
  const [sheetImageLoadError, setSheetImageLoadError] = useState(false);
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false);
  const friendOverlayDebounceRef = useRef<number | null>(null);
  const [, startTransition] = useTransition();

  const syncCurrentLocation = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setUserLocation(DEFAULT_LOCATION);
      setLocationLabel("location unavailable");
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
        setLocationLabel("location unavailable");
        setIsLocationReady(true);
      },
      { enableHighAccuracy: true, timeout: 7000 },
    );
  }, []);

  useEffect(() => {
    setSheetImageLoadError(false);
  }, [selectedEvent?.id]);

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

    client.auth.getSession().then(({ data }) => {
      setAuthUserId(data.session?.user?.id ?? null);
    });
  }, []);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client || !authUserId) return;
    client
      .from("profiles")
      .select("interests")
      .eq("id", authUserId)
      .maybeSingle()
      .then(({ data }) => {
        setUserInterests(Array.isArray(data?.interests) ? data.interests : []);
      });
  }, [authUserId]);

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
    visibility: "public" | "friends" | "close_friends" | "only_me" = "friends",
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
  const allSubcategories = useMemo(() => {
    const values = new Set<string>();
    for (const event of events) {
      for (const subcategory of event.subcategories ?? []) {
        if (subcategory.trim()) values.add(subcategory.trim().toLowerCase());
      }
    }
    return Array.from(values).slice(0, 40);
  }, [events]);

  const metadataFilteredEvents = useMemo(
    () =>
      searchedEvents.filter((event) => {
        if (sportsFilter === "sports_only" && !event.isSports) return false;
        if (alcoholFilter !== "all") {
          if (alcoholFilter === "alcoholic" && event.alcoholPolicy !== "alcoholic" && event.alcoholPolicy !== "mixed") {
            return false;
          }
          if (alcoholFilter === "non_alcoholic" && event.alcoholPolicy !== "non_alcoholic") {
            return false;
          }
        }
        if (priceFilter !== "all" && event.priceTier !== priceFilter) return false;
        if (subcategoryFilter !== "all") {
          const subs = (event.subcategories ?? []).map((value) => value.toLowerCase());
          if (!subs.includes(subcategoryFilter.toLowerCase())) return false;
        }
        return true;
      }),
    [searchedEvents, sportsFilter, alcoholFilter, priceFilter, subcategoryFilter],
  );

  const timeWindowIndex = TIME_WINDOWS.indexOf(timeWindow);
  const radiusSliderProgress = ((radiusKm - MIN_RADIUS_KM) / (MAX_RADIUS_KM - MIN_RADIUS_KM)) * 100;
  const timeSliderProgress = (timeWindowIndex / (TIME_WINDOWS.length - 1)) * 100;
  const isEventSheetOpen = Boolean(selectedEvent);
  const filteredEvents = useMemo(() => {
    const baseTimeFiltered = metadataFilteredEvents.filter((event) => matchesTimeWindow(event, timeWindow, now));
    const radiusApplied = isRadiusEnabled
      ? baseTimeFiltered.filter((event) => distanceInKm(event.location, userLocation) <= radiusKm)
      : baseTimeFiltered;
    const viewportApplied =
      FEATURE_FLAGS.viewportQueryMode && !isRadiusEnabled && viewport
        ? radiusApplied.filter((event) => isInsideViewport(event.location, viewport))
        : radiusApplied;
    const recommendedApplied =
      FEATURE_FLAGS.recommendedMode && discoveryMode === "recommended"
        ? [...viewportApplied].sort((left, right) => {
            const scoreDiff = scoreEventForInterests(right, userInterests) - scoreEventForInterests(left, userInterests);
            if (scoreDiff !== 0) return scoreDiff;
            if (right.startAtIso && left.startAtIso) {
              return new Date(left.startAtIso).getTime() - new Date(right.startAtIso).getTime();
            }
            return right.title.localeCompare(left.title);
          })
        : viewportApplied;
    return recommendedApplied;
  }, [
    metadataFilteredEvents,
    timeWindow,
    now,
    isRadiusEnabled,
    userLocation,
    radiusKm,
    viewport,
    discoveryMode,
    userInterests,
  ]);

  useEffect(() => {
    if (!FEATURE_FLAGS.friendAttendanceOverlay) return;
    if (!authUserId || filteredEvents.length === 0) {
      setFriendAttendanceByEventId({});
      return;
    }
    if (friendOverlayDebounceRef.current) {
      window.clearTimeout(friendOverlayDebounceRef.current);
    }
    friendOverlayDebounceRef.current = window.setTimeout(() => {
      const client = getSupabaseBrowserClient();
      if (!client) return;
      const eventIds = filteredEvents.slice(0, 80).map((event) => event.id);
      client
        .rpc("app_list_event_friend_attendance", {
          event_ids: eventIds,
          max_per_event: 4,
          statuses: ["going", "checked_in"],
        })
        .then(({ data, error }) => {
          if (error) {
            console.error("[friend-attendance] failed", error);
            return;
          }
          const grouped: Record<string, Array<(typeof friendAttendanceByEventId)[string][number]>> = {};
          for (const row of (data ?? []) as Array<(typeof friendAttendanceByEventId)[string][number] & { event_id: string }>) {
            if (!grouped[row.event_id]) grouped[row.event_id] = [];
            grouped[row.event_id].push({
              user_id: row.user_id,
              username: row.username,
              display_name: row.display_name,
              attendee_position: row.attendee_position,
              total_visible: row.total_visible,
              is_close_friend: row.is_close_friend,
            });
          }
          setFriendAttendanceByEventId(grouped);
        });
    }, 320);
    return () => {
      if (friendOverlayDebounceRef.current) {
        window.clearTimeout(friendOverlayDebounceRef.current);
      }
    };
  }, [authUserId, filteredEvents]);

  const selectedEventFriends = selectedEvent ? friendAttendanceByEventId[selectedEvent.id] ?? [] : [];

  const onMapViewportChange = useCallback(
    (nextViewport: Viewport) => {
      setViewport((currentViewport) =>
        viewportChangedEnough(currentViewport, nextViewport) ? nextViewport : currentViewport,
      );
    },
    [setViewport],
  );

  const filterPanel = (
    <Card className="glass-panel pointer-events-auto w-[270px] border-white/35">
      <CardContent className="space-y-3 p-3">
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={discoveryMode === "recommended" ? "default" : "outline"}
            onClick={() => setDiscoveryMode("recommended")}
            className={`icon-filter-btn h-9 text-xs ${
              discoveryMode === "recommended" ? "icon-filter-btn--active" : ""
            }`}
          >
            <Sparkles className="mr-1 h-3.5 w-3.5" />
            Recommended
          </Button>
          <Button
            type="button"
            variant={discoveryMode === "all" ? "default" : "outline"}
            onClick={() => setDiscoveryMode("all")}
            className={`icon-filter-btn h-9 text-xs ${discoveryMode === "all" ? "icon-filter-btn--active" : ""}`}
          >
            All
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          {FILTERS.map((filter) => (
            <Button
              key={filter.value}
              type="button"
              variant={selectedCategory === filter.value ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedCategory(filter.value)}
              className={`icon-filter-btn h-8 px-2 text-[11px] ${
                selectedCategory === filter.value ? "icon-filter-btn--active" : ""
              }`}
            >
              {filter.label}
            </Button>
          ))}
        </div>

        <div className="space-y-2">
          <select
            value={sportsFilter}
            onChange={(event) => setSportsFilter(event.target.value as SportsFilter)}
            className="h-9 w-full rounded-[11px] border border-zinc-300 bg-white px-2 text-xs text-zinc-700"
          >
            <option value="all">All events</option>
            <option value="sports_only">Sports only</option>
          </select>
          <select
            value={alcoholFilter}
            onChange={(event) => setAlcoholFilter(event.target.value as AlcoholFilter)}
            className="h-9 w-full rounded-[11px] border border-zinc-300 bg-white px-2 text-xs text-zinc-700"
          >
            <option value="all">Alcohol: all</option>
            <option value="alcoholic">Alcoholic</option>
            <option value="non_alcoholic">Non alcoholic</option>
          </select>
          <select
            value={priceFilter}
            onChange={(event) => setPriceFilter(event.target.value as PriceFilter)}
            className="h-9 w-full rounded-[11px] border border-zinc-300 bg-white px-2 text-xs text-zinc-700"
          >
            <option value="all">Price: all</option>
            <option value="free">Free</option>
            <option value="budget">Budget</option>
            <option value="mid">Mid</option>
            <option value="premium">Premium</option>
          </select>
          <select
            value={subcategoryFilter}
            onChange={(event) => setSubcategoryFilter(event.target.value)}
            className="h-9 w-full rounded-[11px] border border-zinc-300 bg-white px-2 text-xs text-zinc-700"
          >
            <option value="all">All tags</option>
            {allSubcategories.map((subcategory) => (
              <option key={subcategory} value={subcategory}>
                {subcategory}
              </option>
            ))}
          </select>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <main className="relative h-[100dvh] min-h-[100svh] w-full overflow-hidden bg-[#eef1f5] text-zinc-900">
      {isLocationReady ? (
        <MapView
          events={filteredEvents}
          onSelectEvent={(event) => setSelectedEvent(event)}
          userLocation={userLocation}
          radiusKm={radiusKm}
          showRadiusIndicator={isRadiusEnabled}
          isPickingLocation={isRadiusEnabled && locationMode === "pick"}
          friendAttendanceByEventId={friendAttendanceByEventId}
          onViewportChange={onMapViewportChange}
          onPickLocation={(location) => {
            if (locationMode !== "pick" || !isRadiusEnabled) {
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
        {filterPanel}
      </div>

      <Sheet open={isMobileFilterOpen} onOpenChange={setIsMobileFilterOpen}>
        <SheetContent
          side="left"
          className="z-[1500] w-[86vw] max-w-[320px] border border-white/85 bg-white/92 px-3 pb-4 pt-8 backdrop-blur-3xl"
        >
          <SheetHeader>
            <SheetTitle className="text-base">Filters</SheetTitle>
            <SheetDescription>Clean controls for discovery mode and event filters.</SheetDescription>
          </SheetHeader>
          <div className="mt-3">{filterPanel}</div>
        </SheetContent>
      </Sheet>

      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 z-[1200] pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-all duration-200 sm:pb-4 ${
          isEventSheetOpen ? "translate-y-6 opacity-0 sm:translate-y-0 sm:opacity-100" : "translate-y-0 opacity-100"
        }`}
      >
        <div className="mx-auto w-full max-w-4xl px-3 sm:px-4">
          <Card className="glass-panel discover-dock pointer-events-auto w-full border-white/30 animate-rise-delayed">
            <CardContent className="flex flex-col gap-2.5 p-2.5 pt-3 sm:gap-3 sm:p-4 sm:pt-5">
              <div className="flex flex-col gap-2 pt-0.5 sm:flex-row sm:items-start sm:justify-between">
                <div className="pointer-events-auto max-w-full overflow-x-auto no-scrollbar">
                  <p className="inline-flex items-center gap-1 whitespace-nowrap text-[14px] font-semibold text-zinc-900 sm:text-[17px]">
                    <span>{filteredEvents.length}</span>
                    <span>spontaneous things in</span>
                    <button
                      type="button"
                      onClick={() =>
                        setOpenDiscoverControl((current) => (current === "radius" ? null : "radius"))
                      }
                      className={`discover-inline-chip ${
                        openDiscoverControl === "radius" ? "discover-inline-chip--active" : ""
                      }`}
                    >
                      {isRadiusEnabled ? formatRadiusLabel(radiusKm) : "map view"}
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

                <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 sm:gap-2">
                  <Button
                    type="button"
                    variant={locationMode === "current" ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setLocationMode("current");
                      syncCurrentLocation();
                    }}
                    className={`icon-filter-btn h-8 rounded-[11px] px-2.5 text-[11px] sm:h-9 sm:rounded-[12px] sm:px-3 sm:text-xs ${
                      locationMode === "current" ? "icon-filter-btn--active" : ""
                    }`}
                  >
                    <MapPin className="mr-1 h-3.5 w-3.5" />
                    current
                  </Button>
                  <Button
                    type="button"
                    variant={isRadiusEnabled ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setIsRadiusEnabled((current) => {
                        const next = !current;
                        if (!next) {
                          setLocationMode("current");
                        }
                        return next;
                      });
                    }}
                    className={`icon-filter-btn h-8 rounded-[11px] px-2.5 text-[11px] sm:h-9 sm:rounded-[12px] sm:px-3 sm:text-xs ${
                      isRadiusEnabled ? "icon-filter-btn--active" : ""
                    }`}
                  >
                    radius {isRadiusEnabled ? "on" : "off"}
                  </Button>
                  <Button
                    type="button"
                    variant={locationMode === "pick" ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      if (!isRadiusEnabled) return;
                      setLocationMode("pick");
                    }}
                    disabled={!isRadiusEnabled}
                    className={`icon-filter-btn h-8 rounded-[11px] px-2.5 text-[11px] sm:h-9 sm:rounded-[12px] sm:px-3 sm:text-xs ${
                      locationMode === "pick" && isRadiusEnabled ? "icon-filter-btn--active" : ""
                    }`}
                  >
                    <Crosshair className="mr-1 h-3.5 w-3.5" />
                    pick
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsMobileFilterOpen(true)}
                    className="icon-filter-btn h-8 rounded-[11px] px-2.5 text-[11px] sm:h-9 sm:rounded-[12px] sm:px-3 sm:text-xs lg:hidden"
                  >
                    filters
                  </Button>
                </div>
              </div>

              {openDiscoverControl === "radius" ? (
                <div className="pointer-events-auto discover-control-panel">
                  <div className="discover-control-panel__head">
                    <span className="discover-control-panel__title">range</span>
                    <span className="discover-control-panel__value">{formatRadiusLabel(radiusKm)}</span>
                  </div>
                  {isRadiusEnabled ? (
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
                  ) : (
                    <p className="text-xs text-zinc-600">
                      Radius is off by default. Turn it on to restrict feed and enable pick mode.
                    </p>
                  )}
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
                      const nextWindow = TIME_WINDOWS[index] ?? "1d";
                      setTimeWindow(nextWindow);
                    }}
                    className="discover-slider"
                    style={{ "--slider-progress": `${timeSliderProgress}%` } as CSSProperties}
                    aria-label="Event time window"
                  />
                  <div className="discover-slider-labels">
                    <span>3h</span>
                    <span>12h</span>
                    <span>1d</span>
                    <span>3d</span>
                    <span>1w</span>
                    <span>any</span>
                  </div>
                </div>
              ) : null}

              <div className="pointer-events-auto">
                <Badge variant="secondary" className="glass-badge bg-white/65 text-zinc-700">
                  {locationLabel}
                </Badge>
                {locationMode === "pick" && isRadiusEnabled ? (
                  <p className="mt-1.5 text-[11px] text-zinc-600">pick mode: tap anywhere on the map to pin.</p>
                ) : null}
              </div>

              <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
                <div className="pointer-events-auto relative min-w-0 flex-1 lg:min-w-[220px]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="search for anything..."
                    className="h-10 w-full rounded-[13px] border border-zinc-300/70 bg-white/82 pl-9 pr-3 text-[13px] text-zinc-800 outline-none placeholder:text-zinc-500 focus:border-zinc-400 sm:h-11 sm:rounded-[14px] sm:text-sm"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5 sm:gap-2">
                  {authUserId ? (
                    <>
                      <Link href="/profile/settings" className="icon-filter-btn h-9 rounded-[12px] border border-zinc-300 bg-white px-3 py-2 text-[12px] text-zinc-700 sm:h-11 sm:rounded-[14px] sm:px-4 sm:text-sm">
                        profile
                      </Link>
                      <Link href="/friends" className="icon-filter-btn h-9 rounded-[12px] border border-zinc-300 bg-white px-3 py-2 text-[12px] text-zinc-700 sm:h-11 sm:rounded-[14px] sm:px-4 sm:text-sm">
                        friends
                      </Link>
                      <Link href="/saved" className="icon-filter-btn h-9 rounded-[12px] border border-zinc-300 bg-white px-3 py-2 text-[12px] text-zinc-700 sm:h-11 sm:rounded-[14px] sm:px-4 sm:text-sm">
                        saved
                      </Link>
                    </>
                  ) : (
                    <Link href="/auth" className="icon-filter-btn h-9 rounded-[12px] border border-zinc-300 bg-white px-3 py-2 text-[12px] text-zinc-700 sm:h-11 sm:rounded-[14px] sm:px-4 sm:text-sm">
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
          className="sheet-native-scroll mx-auto z-[1400] max-h-[85dvh] max-w-3xl overflow-y-auto rounded-t-[22px] border border-white/85 bg-white/88 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-12 shadow-[0_30px_80px_rgba(15,23,42,0.35)] backdrop-blur-3xl sm:px-5"
        >
          {selectedEvent ? (
            <>
              <div className="mb-4 flex items-start justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void toggleSave(selectedEvent.id)}
                  className="h-8 rounded-full px-3 text-xs"
                >
                  {savedEventIds.has(selectedEvent.id) ? "Saved" : "Save"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (!selectedEvent.sourceUrl) {
                      return;
                    }
                    if (navigator.share) {
                      void navigator.share({
                        title: selectedEvent.title,
                        text: `Check this event: ${selectedEvent.title}`,
                        url: selectedEvent.sourceUrl,
                      });
                      return;
                    }
                    void navigator.clipboard.writeText(selectedEvent.sourceUrl);
                    alert("Event link copied.");
                  }}
                  disabled={!selectedEvent.sourceUrl}
                  className="h-8 rounded-full px-3 text-xs"
                >
                  Share
                </Button>
              </div>
              {selectedEvent.photoUrl && !sheetImageLoadError ? (
                <div className="relative mb-4 overflow-hidden rounded-2xl border border-white/90 bg-zinc-100/60 shadow-[0_16px_28px_rgba(15,23,42,0.2)]">
                  <Image
                    src={selectedEvent.photoUrl}
                    alt={selectedEvent.title}
                    width={1200}
                    height={640}
                    className="h-44 w-full object-cover sm:h-56"
                    onError={() => setSheetImageLoadError(true)}
                  />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-zinc-900/35 via-zinc-900/10 to-transparent" />
                </div>
              ) : null}
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

              <p className="mt-6 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">attendance</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  onClick={() => void setAttendance(selectedEvent.id, "interested", "friends")}
                  variant="outline"
                  className="h-10"
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
                  variant="secondary"
                  className="h-10"
                >
                  Not Going
                </Button>
                <Button
                  type="button"
                  onClick={() => void checkInToEvent(selectedEvent.id)}
                  variant="outline"
                  className="h-10"
                >
                  Check in
                </Button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Button type="button" onClick={() => void setAttendance(selectedEvent.id, "going", "public")} variant="outline" className="h-9 text-xs">
                  Public
                </Button>
                <Button type="button" onClick={() => void setAttendance(selectedEvent.id, "going", "friends")} variant="outline" className="h-9 text-xs">
                  Friends
                </Button>
                <Button type="button" onClick={() => void setAttendance(selectedEvent.id, "going", "close_friends")} variant="outline" className="h-9 text-xs">
                  Close friends
                </Button>
                <Button type="button" onClick={() => void setAttendance(selectedEvent.id, "going", "only_me")} variant="outline" className="h-9 text-xs">
                  Only me
                </Button>
              </div>
              <p className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">friends going</p>
              {selectedEventFriends.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedEventFriends.map((friend) => (
                    <Link
                      key={`${friend.user_id}-${friend.attendee_position}`}
                      href={friend.username ? `/profile/${friend.username}` : "/friends"}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        friend.is_close_friend
                          ? "border-amber-400 bg-amber-100 text-amber-900"
                          : "border-zinc-300 bg-white text-zinc-700"
                      }`}
                    >
                      {friend.display_name?.trim() || friend.username || "friend"}
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-zinc-600">No visible friends marked as going yet.</p>
              )}
              <p className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">event</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  onClick={() => {
                    if (selectedEvent.sourceUrl) {
                      window.open(selectedEvent.sourceUrl, "_blank", "noopener,noreferrer");
                    }
                  }}
                  variant="outline"
                  disabled={!selectedEvent.sourceUrl}
                  className="h-10"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open source
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    if (selectedEvent.sourceUrl) {
                      void navigator.clipboard.writeText(selectedEvent.sourceUrl);
                      alert("Event link copied.");
                    }
                  }}
                  variant="outline"
                  disabled={!selectedEvent.sourceUrl}
                  className="h-10"
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
