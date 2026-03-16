"use client";

import { Fragment, useEffect } from "react";
import {
  CircleMarker,
  MapContainer,
  TileLayer,
  Tooltip,
  ZoomControl,
  useMap,
} from "react-leaflet";
import { Line, LineChart } from "recharts";
import { Radar, X } from "lucide-react";
import { formatCurrency, formatPercent } from "@/lib/format";
import { COMING_SOON, hasValue } from "@/lib/display";

const defaultCenter = [25.2048, 55.2708];
const defaultZoom = 10;

function getMarkerColor(dropPercent) {
  if (dropPercent >= 20) {
    return "#ff2d55";
  }

  if (dropPercent >= 14) {
    return "#ff7b40";
  }

  return "#ffd60a";
}

function MapViewport({ activeArea, areaSummaries }) {
  const map = useMap();

  useEffect(() => {
    if (!activeArea) {
      map.flyTo(defaultCenter, defaultZoom, { duration: 1.2 });
      return;
    }

    const selectedArea = areaSummaries.find((summary) => summary.area === activeArea);

    if (selectedArea) {
      map.flyTo([selectedArea.lat, selectedArea.lng], 11.7, { duration: 1.2 });
    }
  }, [activeArea, areaSummaries, map]);

  return null;
}

export default function DubaiMap({
  activeArea,
  clearActiveArea,
  onAreaSelect,
  areaSummaries,
}) {
  const populatedAreas = areaSummaries.filter((area) =>
    area.dropCount > 0 ? true : area.listingCount > 0
  );
  const hottestArea = populatedAreas[0];
  const topAreas = populatedAreas.slice(0, 3);

  return (
    <div className="relative h-full overflow-hidden rounded-[24px] border border-white/8">
      <MapContainer
        center={defaultCenter}
        zoom={defaultZoom}
        zoomControl={false}
        scrollWheelZoom={false}
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        <ZoomControl position="bottomright" />
        <MapViewport activeArea={activeArea} areaSummaries={areaSummaries} />

        {populatedAreas.map((area) => {
          const color = getMarkerColor(area.avgDropPercent ?? 0);
          const isHottest = hottestArea?.area === area.area;
          const areaCount = area.dropCount || area.listingCount;

          return (
            <Fragment key={area.area}>
              {isHottest && (
                <CircleMarker
                  center={[area.lat, area.lng]}
                  radius={Math.max(areaCount * 4, 18)}
                  pathOptions={{
                    color,
                    fillColor: color,
                    fillOpacity: 0.08,
                    weight: 1,
                    className: "hotspot hotspot-pulse",
                  }}
                />
              )}

              <CircleMarker
                center={[area.lat, area.lng]}
                radius={Math.max(areaCount * 2.5, 10)}
                pathOptions={{
                  color,
                  fillColor: color,
                  fillOpacity: 0.65,
                  weight: 1.5,
                  className: "hotspot",
                }}
                eventHandlers={{
                  click: () => onAreaSelect(area.area),
                }}
              >
                <Tooltip direction="top" offset={[0, -12]} opacity={1}>
                  <div className="min-w-[170px]">
                    <div className="mono text-[10px] uppercase tracking-[0.26em] text-white/40">
                      {area.label}
                    </div>
                    <div className="mt-2 text-sm text-white">
                      {area.dropCount > 0
                        ? `${area.dropCount} deals · Avg ${formatPercent(area.avgDropPercent ?? 0)}`
                        : `${area.listingCount} listings in area`}
                    </div>
                    <div className="mt-1 text-xs text-white/55">
                      {hasValue(area.avgDropAmount)
                        ? `Avg below pre-war ${formatCurrency(area.avgDropAmount, { compact: true })}`
                        : "Pre-war analytics coming soon."}
                    </div>
                  </div>
                </Tooltip>
              </CircleMarker>
            </Fragment>
          );
        })}
      </MapContainer>

      <div className="pointer-events-none absolute inset-x-4 top-4 flex items-start justify-between gap-3">
        <div className="pointer-events-auto rounded-full border border-white/10 bg-black/70 px-4 py-2 text-[11px] uppercase tracking-[0.28em] text-[#00e5ff] backdrop-blur">
          Dubai live map
        </div>

        {activeArea && (
          <button
            onClick={clearActiveArea}
            className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/70 px-4 py-2 text-[11px] uppercase tracking-[0.24em] text-white/70 backdrop-blur"
          >
            <X className="h-3.5 w-3.5" />
            Clear {activeArea}
          </button>
        )}
      </div>

      <div className="pointer-events-none absolute bottom-4 right-4 w-full max-w-[250px] rounded-[24px] border border-white/10 bg-black/75 p-4 backdrop-blur">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.28em] text-white/38">
          <Radar className="h-4 w-4 text-[#00e5ff]" />
          Top 3 Areas Right Now
        </div>

        <div className="mt-4 space-y-3">
          {topAreas.map((area) => (
            <button
              key={area.area}
              onClick={() => onAreaSelect(area.area)}
              className="pointer-events-auto block w-full rounded-2xl border border-white/8 bg-white/[0.03] p-3 text-left transition hover:border-[#00e5ff]/30 hover:bg-white/[0.05]"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-white">{area.area}</div>
                  <div className="text-xs text-white/45">
                    {area.dropCount > 0
                      ? `${area.dropCount} deals · Avg ${formatPercent(area.avgDropPercent ?? 0)}`
                      : `${area.listingCount} listings`}
                  </div>
                </div>
                <div className="mono text-xs text-[#ffd60a]">
                  {hasValue(area.avgDropAmount)
                    ? formatCurrency(area.avgDropAmount, { compact: true })
                    : COMING_SOON}
                </div>
              </div>

              <div className="mt-3 overflow-hidden rounded-xl">
                <LineChart width={190} height={40} data={area.sparkline.map((value, index) => ({ index, value }))}>
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#ffd60a"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </div>
            </button>
          ))}

          {topAreas.length === 0 && (
            <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-white/40">
              No hotspots match the current filter set.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
