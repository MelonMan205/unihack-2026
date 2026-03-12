import { useMemo, useState } from "react";
import { MapContainer, Marker, TileLayer, Tooltip, useMapEvents } from "react-leaflet";
import { divIcon, type LatLngExpression } from "leaflet";
import type { EventPin } from "../mock/events";

type MarkerDatum =
  | { type: "event"; event: EventPin }
  | { type: "cluster"; key: string; count: number; location: [number, number] };

type MapViewProps = {
  events: EventPin[];
  userLocation: [number, number];
  onSelectEvent: (event: EventPin) => void;
};

const INITIAL_ZOOM = 14;
const CLUSTER_ZOOM_THRESHOLD = 13;

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

function ZoomWatcher({ onZoom }: { onZoom: (zoom: number) => void }) {
  useMapEvents({
    zoomend: (event) => onZoom(event.target.getZoom()),
  });

  return null;
}

function eventIcon(event: EventPin) {
  const safeTitle = escapeHtml(event.title);
  return divIcon({
    html: `
      <div class="photo-pin">
        <div class="photo-pin-card">
          <img src="${event.photoUrl}" alt="${safeTitle}" loading="lazy" />
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

export function MapView({ events, userLocation, onSelectEvent }: MapViewProps) {
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const markers = useMemo(() => buildMarkers(events, zoom), [events, zoom]);

  return (
    <MapContainer
      center={userLocation as LatLngExpression}
      zoom={INITIAL_ZOOM}
      className="apple-map h-[100dvh] w-full"
      zoomControl
    >
      <ZoomWatcher onZoom={setZoom} />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
      />

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
          <Marker
            key={marker.event.id}
            position={marker.event.location}
            icon={eventIcon(marker.event)}
            eventHandlers={{ click: () => onSelectEvent(marker.event) }}
          >
            <Tooltip direction="top">
              <strong>{marker.event.title}</strong>
              <br />
              {marker.event.timeLabel}
            </Tooltip>
          </Marker>
        ) : (
          <Marker key={marker.key} position={marker.location} icon={clusterIcon(marker.count)}>
            <Tooltip direction="top">{marker.count} events in this area</Tooltip>
          </Marker>
        ),
      )}
    </MapContainer>
  );
}
