"use client";

import { Fragment, useMemo, useState } from "react";
import { divIcon, type LatLngExpression } from "leaflet";
import { Circle, MapContainer, Marker, TileLayer, Tooltip, useMapEvents } from "react-leaflet";
import type { EventPin } from "@/mock/events";
import { distanceInKm } from "@/utils/geo";

type MarkerDatum =
  | { type: "event"; event: EventPin }
  | { type: "cluster"; key: string; count: number; location: [number, number] };

type MapViewProps = {
  events: EventPin[];
  userLocation: [number, number];
  radiusKm?: number;
  showRadiusIndicator?: boolean;
  friendAttendanceByEventId?: Record<
    string,
    Array<{
      user_id: string;
      username: string | null;
      display_name: string | null;
      attendee_position: number;
      total_visible: number;
      is_close_friend: boolean;
    }>
  >;
  onViewportChange?: (viewport: { north: number; south: number; east: number; west: number; zoom: number }) => void;
  onSelectEvent: (event: EventPin) => void;
  isPickingLocation?: boolean;
  onPickLocation?: (location: [number, number]) => void;
};

const INITIAL_ZOOM = 14;
const CLUSTER_ZOOM_THRESHOLD = 13;
const MIN_ZOOM = 3;

const categoryCode: Record<EventPin["category"], string> = {
  music: "MU",
  food: "FD",
  fitness: "FT",
  social: "SC",
  arts: "AR",
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function trimText(value: string | undefined, maxChars: number): string {
  if (!value) {
    return "";
  }

  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars - 1)}…`;
}

function ZoomWatcher({ onZoom }: { onZoom: (zoom: number) => void }) {
  useMapEvents({
    zoomend: (event) => onZoom(event.target.getZoom()),
  });

  return null;
}

function ViewportWatcher({
  onViewportChange,
}: {
  onViewportChange?: (viewport: { north: number; south: number; east: number; west: number; zoom: number }) => void;
}) {
  useMapEvents({
    moveend: (event) => {
      if (!onViewportChange) return;
      const bounds = event.target.getBounds();
      onViewportChange({
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest(),
        zoom: event.target.getZoom(),
      });
    },
    zoomend: (event) => {
      if (!onViewportChange) return;
      const bounds = event.target.getBounds();
      onViewportChange({
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest(),
        zoom: event.target.getZoom(),
      });
    },
  });

  return null;
}

function LocationPicker({
  enabled,
  onPickLocation,
}: {
  enabled: boolean;
  onPickLocation?: (location: [number, number]) => void;
}) {
  useMapEvents({
    click: (event) => {
      if (!enabled || !onPickLocation) {
        return;
      }
      const targetElement = event.originalEvent.target as HTMLElement | null;
      if (targetElement?.closest(".leaflet-marker-icon, .leaflet-tooltip, .leaflet-control-container")) {
        return;
      }
      onPickLocation([event.latlng.lat, event.latlng.lng]);
    },
  });

  return null;
}

function eventIcon(event: EventPin) {
  const safeTitle = escapeHtml(event.title);
  return divIcon({
    html: `
      <div class="photo-pin">
        <div class="photo-pin-card">
          <img src="${event.photoUrl}" alt="${safeTitle}" loading="lazy" decoding="async" />
          <div class="photo-pin-overlay"></div>
          <span class="photo-pin-label">${categoryCode[event.category]}</span>
        </div>
        <div class="photo-pin-tip"></div>
      </div>
    `,
    className: "pin-wrapper",
    iconSize: [58, 72],
    iconAnchor: [29, 72],
  });
}

function clusterIcon(count: number) {
  return divIcon({
    html: `<div class="cluster-pin">${count}</div>`,
    className: "pin-wrapper",
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });
}

function friendOverlayIcon(
  attendees: Array<{
    username: string | null;
    display_name: string | null;
    total_visible: number;
    is_close_friend: boolean;
  }>,
) {
  const top = attendees.slice(0, 3);
  const total = attendees[0]?.total_visible ?? top.length;
  const overflow = Math.max(total - top.length, 0);
  const avatarHtml = top
    .map((person, index) => {
      const name = person.display_name?.trim() || person.username?.trim() || "F";
      const initial = escapeHtml(name.slice(0, 1).toUpperCase());
      return `<span class="friend-stack-avatar ${person.is_close_friend ? "friend-stack-avatar--close" : ""}" style="--stack-index:${index}">${initial}</span>`;
    })
    .join("");
  const overflowHtml =
    overflow > 0
      ? `<span class="friend-stack-overflow" style="--stack-index:${top.length}">+${overflow}</span>`
      : "";

  return divIcon({
    html: `<div class="friend-stack">${avatarHtml}${overflowHtml}</div>`,
    className: "pin-wrapper",
    iconSize: [58, 26],
    iconAnchor: [29, 2],
  });
}

function buildMarkers(events: EventPin[], zoom: number): MarkerDatum[] {
  if (zoom >= CLUSTER_ZOOM_THRESHOLD) {
    return events.map((event) => ({ type: "event", event }));
  }

  const buckets = new Map<string, EventPin[]>();
  events.forEach((event) => {
    const lat = event.location[0];
    const lng = event.location[1];
    const key = `${Math.round(lat * 200) / 200}-${Math.round(lng * 200) / 200}`;
    const values = buckets.get(key) ?? [];
    values.push(event);
    buckets.set(key, values);
  });

  const markers: MarkerDatum[] = [];
  buckets.forEach((bucket, key) => {
    if (bucket.length === 1) {
      markers.push({ type: "event", event: bucket[0] });
      return;
    }

    const lat = bucket.reduce((acc, event) => acc + event.location[0], 0) / bucket.length;
    const lng = bucket.reduce((acc, event) => acc + event.location[1], 0) / bucket.length;
    markers.push({ type: "cluster", key, count: bucket.length, location: [lat, lng] });
  });

  return markers;
}

export function MapView({
  events,
  userLocation,
  radiusKm = 1,
  showRadiusIndicator = true,
  friendAttendanceByEventId = {},
  onViewportChange,
  onSelectEvent,
  isPickingLocation = false,
  onPickLocation,
}: MapViewProps) {
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const markers = useMemo(() => buildMarkers(events, zoom), [events, zoom]);

  return (
    <MapContainer
      center={userLocation as LatLngExpression}
      zoom={INITIAL_ZOOM}
      minZoom={MIN_ZOOM}
      zoomSnap={0.5}
      zoomDelta={0.5}
      wheelPxPerZoomLevel={140}
      className={`apple-map h-[100dvh] w-full ${isPickingLocation ? "apple-map--pick-location" : ""}`}
      zoomControl
    >
      <ZoomWatcher onZoom={setZoom} />
      <ViewportWatcher onViewportChange={onViewportChange} />
      <LocationPicker enabled={isPickingLocation} onPickLocation={onPickLocation} />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        noWrap
      />

      {showRadiusIndicator ? (
        <Circle
          center={userLocation}
          radius={radiusKm * 1000}
          pathOptions={{
            color: "#f59e0b",
            weight: 1.5,
            opacity: 0.75,
            fillColor: "#facc15",
            fillOpacity: 0.14,
          }}
        />
      ) : null}

      <Marker
        position={userLocation}
        icon={divIcon({
          html: '<div class="user-pin"></div>',
          className: "pin-wrapper",
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        })}
      >
        <Tooltip direction="top">You are here</Tooltip>
      </Marker>

      {markers.map((marker) =>
        marker.type === "event" ? (
          <Fragment key={marker.event.id}>
            <Marker
              position={marker.event.location}
              icon={eventIcon(marker.event)}
              eventHandlers={{
                click: (event) => {
                  event.originalEvent.stopPropagation();
                  onSelectEvent(marker.event);
                },
              }}
            >
              <Tooltip direction="top" offset={[0, -18]} className="event-hover-card" opacity={1}>
                <div className="event-hover-card__title">{marker.event.title}</div>
                <div className="event-hover-card__image-wrap"></div>
                <div className="event-hover-card__meta">
                  <span className="event-hover-card__dot" />
                  <span>{marker.event.timeLabel}</span>
                </div>
                <div className="event-hover-card__meta">
                  <span className="event-hover-card__dot" />
                  <span>{marker.event.venue}</span>
                </div>
                <div className="event-hover-card__pill-row">
                  <span className="event-hover-card__pill event-hover-card__pill--highlight">
                    {marker.event.timeLabel}
                  </span>
                  <span className="event-hover-card__pill">
                    {distanceInKm(marker.event.location, userLocation).toFixed(1)} km
                  </span>
                  <span className="event-hover-card__pill">
                    Spontaneity {marker.event.spontaneityScore}/100
                  </span>
                  <span className="event-hover-card__pill">{marker.event.crowdLabel}</span>
                </div>
                {marker.event.description ? (
                  <div className="event-hover-card__desc">{trimText(marker.event.description, 88)}</div>
                ) : null}
                {marker.event.tags.length > 0 ? (
                  <div className="event-hover-card__tags">
                    {marker.event.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="event-hover-card__tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
              </Tooltip>
            </Marker>
            {friendAttendanceByEventId[marker.event.id]?.length ? (
              <Marker
                key={`${marker.event.id}-friends`}
                position={marker.event.location}
                icon={friendOverlayIcon(friendAttendanceByEventId[marker.event.id])}
                interactive={false}
                keyboard={false}
                zIndexOffset={700}
              />
            ) : null}
          </Fragment>
        ) : (
          <Marker key={marker.key} position={marker.location} icon={clusterIcon(marker.count)}>
            <Tooltip direction="top" offset={[0, -10]} className="event-hover-card event-hover-card--compact" opacity={1}>
              {marker.count} events in this area
            </Tooltip>
          </Marker>
        ),
      )}
    </MapContainer>
  );
}
