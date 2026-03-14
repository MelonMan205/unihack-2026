import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_LOCATION, type Category, type EventPin } from "@/mock/events";

type SupabaseEventRow = {
  id: string;
  title: string;
  venue: string | null;
  time_label: string | null;
  description: string | null;
  source_url: string | null;
  photo_url: string | null;
  location: string | null;
  category: string | null;
  spontaneity_score: number | null;
  crowd_label: string | null;
  tags: string[] | null;
  created_at: string;
  event_crowd_forecasts?: {
    forecast_label: string;
    confidence: number;
  } | null;
};

const EVENT_PHOTO_FALLBACK =
  "https://images.unsplash.com/photo-1527529482837-4698179dc6ce?auto=format&fit=crop&w=420&q=80";

const LOCATION_JITTER: [number, number][] = [
  [0.006, 0.004],
  [-0.005, 0.003],
  [0.004, -0.006],
  [-0.003, -0.004],
  [0.007, -0.002],
];

function normalizeCategory(value: string | null): Category {
  const normalized = value?.trim().toLowerCase();

  if (
    normalized === "music" ||
    normalized === "food" ||
    normalized === "fitness" ||
    normalized === "social" ||
    normalized === "arts"
  ) {
    return normalized;
  }

  return "social";
}

function normalizeCrowdLabel(value: string | null): EventPin["crowdLabel"] {
  switch (value?.trim().toLowerCase()) {
    case "quiet":
      return "Low-key";
    case "moderate":
    case "busy":
      return "Good vibe";
    case "packed":
      return "Packed";
    default:
      return "Good vibe";
  }
}

function normalizeForecastLabel(value: string | null | undefined): EventPin["crowdLabel"] | null {
  switch (value) {
    case "low":
      return "Low-key";
    case "medium":
      return "Good vibe";
    case "high":
      return "Packed";
    default:
      return null;
  }
}

function parseLocation(location: string | null): [number, number] | null {
  if (!location) {
    return null;
  }

  const raw = location.trim();
  if (!raw) {
    return null;
  }

  const directPair = raw.match(
    /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/,
  );

  if (directPair) {
    const lat = Number(directPair[1]);
    const lng = Number(directPair[2]);

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return [lat, lng];
    }
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (Array.isArray(parsed) && parsed.length >= 2) {
      const lat = Number(parsed[0]);
      const lng = Number(parsed[1]);

      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return [lat, lng];
      }
    }

    if (parsed && typeof parsed === "object") {
      const maybeObj = parsed as { lat?: unknown; lng?: unknown };
      const lat = Number(maybeObj.lat);
      const lng = Number(maybeObj.lng);

      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return [lat, lng];
      }
    }
  } catch {
    // Continue to regex extraction for free-form text locations.
  }

  const embeddedPair = raw.match(
    /(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/,
  );

  if (embeddedPair) {
    const lat = Number(embeddedPair[1]);
    const lng = Number(embeddedPair[2]);

    if (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180
    ) {
      return [lat, lng];
    }
  }

  return null;
}

function fallbackLocation(index: number): [number, number] {
  const [latJitter, lngJitter] = LOCATION_JITTER[index % LOCATION_JITTER.length];
  return [DEFAULT_LOCATION[0] + latJitter, DEFAULT_LOCATION[1] + lngJitter];
}

function mapRowToEventPin(row: SupabaseEventRow, index: number): EventPin {
  const forecastLabel = normalizeForecastLabel(row.event_crowd_forecasts?.forecast_label);
  return {
    id: row.id,
    title: row.title,
    venue: row.venue ?? "Venue TBA",
    timeLabel: row.time_label ?? "Happening soon",
    description: row.description ?? "",
    sourceUrl: row.source_url ?? undefined,
    photoUrl: row.photo_url ?? EVENT_PHOTO_FALLBACK,
    location: parseLocation(row.location) ?? fallbackLocation(index),
    category: normalizeCategory(row.category),
    spontaneityScore: row.spontaneity_score ?? 70,
    crowdLabel: forecastLabel ?? normalizeCrowdLabel(row.crowd_label),
    tags: row.tags?.filter(Boolean) ?? [],
  };
}

export async function fetchEventsFromSupabase(client: SupabaseClient): Promise<EventPin[]> {
  const { data, error } = await client
    .from("events")
    .select(
      "id,title,venue,time_label,description,source_url,photo_url,location,category,spontaneity_score,crowd_label,tags,created_at,event_crowd_forecasts(forecast_label,confidence)",
    )
    .order("created_at", { ascending: false })
    .limit(200)
    .returns<SupabaseEventRow[]>();

  if (error) {
    throw error;
  }

  return (data ?? []).map(mapRowToEventPin);
}
