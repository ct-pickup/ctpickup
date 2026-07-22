import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MapView, { Marker, type Region } from "react-native-maps";
import Svg, { Circle } from "react-native-svg";
import { Stack, useRouter } from "expo-router";
import { format, isToday, isTomorrow } from "date-fns";
import * as Location from "expo-location";
import { useAuth } from "@/context/AuthContext";

// ─── design tokens ──────────────────────────────────────────────────────────

const LIME = "#a3e635";
const BG = "#0B0F0D";
const SURFACE = "#151B18";
const SURFACE_LIFT = "#1E2723";
const HAIRLINE = "rgba(255,255,255,0.08)";
const CHALK = "#F2F4F1";
const MUTED = "#8A968F";
const GREEN_MED = "#4a7c59";

const CT_REGION: Region = {
  latitude: 39.0,
  longitude: -75.8,
  latitudeDelta: 9.0,
  longitudeDelta: 9.0,
};

/** Zoomed-out (latitudeDelta >= 4): merge nearby sub-regions into these mega-clusters. */
const MACRO_LAT_DELTA = 4;

// ─── ZIP centroid lookup ─────────────────────────────────────────────────────

type ZipInfo = { lat: number; lon: number; city: string; region: string };

const ZIP_INFO: Record<string, ZipInfo> = {
  // Hartford Metro
  "06101": { lat: 41.7637, lon: -72.6851, city: "Hartford", region: "Hartford Metro" },
  "06103": { lat: 41.7637, lon: -72.6826, city: "Hartford", region: "Hartford Metro" },
  "06105": { lat: 41.7708, lon: -72.7010, city: "Hartford", region: "Hartford Metro" },
  "06106": { lat: 41.7550, lon: -72.6963, city: "Hartford", region: "Hartford Metro" },
  "06107": { lat: 41.7646, lon: -72.7329, city: "West Hartford", region: "Hartford Metro" },
  "06108": { lat: 41.7737, lon: -72.6537, city: "East Hartford", region: "Hartford Metro" },
  "06109": { lat: 41.7319, lon: -72.6480, city: "Wethersfield", region: "Hartford Metro" },
  "06110": { lat: 41.7477, lon: -72.7113, city: "West Hartford", region: "Hartford Metro" },
  "06111": { lat: 41.6975, lon: -72.7213, city: "Newington", region: "Hartford Metro" },
  "06112": { lat: 41.7902, lon: -72.7032, city: "Hartford", region: "Hartford Metro" },
  "06114": { lat: 41.7524, lon: -72.6695, city: "Hartford", region: "Hartford Metro" },
  "06118": { lat: 41.7741, lon: -72.6164, city: "East Hartford", region: "Hartford Metro" },
  "06120": { lat: 41.7902, lon: -72.6882, city: "Hartford", region: "Hartford Metro" },
  // New Haven Area
  "06510": { lat: 41.3083, lon: -72.9279, city: "New Haven", region: "New Haven Area" },
  "06511": { lat: 41.3214, lon: -72.9298, city: "New Haven", region: "New Haven Area" },
  "06512": { lat: 41.2806, lon: -72.9214, city: "East Haven", region: "New Haven Area" },
  "06513": { lat: 41.3014, lon: -72.9094, city: "New Haven", region: "New Haven Area" },
  "06514": { lat: 41.3614, lon: -72.9476, city: "Hamden", region: "New Haven Area" },
  "06515": { lat: 41.3247, lon: -72.9668, city: "New Haven", region: "New Haven Area" },
  "06516": { lat: 41.2870, lon: -72.9796, city: "West Haven", region: "New Haven Area" },
  "06517": { lat: 41.3408, lon: -72.9073, city: "Hamden", region: "New Haven Area" },
  "06518": { lat: 41.3975, lon: -72.9168, city: "Hamden", region: "New Haven Area" },
  "06519": { lat: 41.3014, lon: -72.9396, city: "New Haven", region: "New Haven Area" },
  "06460": { lat: 41.2237, lon: -73.0568, city: "Milford", region: "New Haven Area" },
  "06461": { lat: 41.2515, lon: -73.0679, city: "Milford", region: "New Haven Area" },
  "06477": { lat: 41.2737, lon: -73.0215, city: "Orange", region: "New Haven Area" },
  "06418": { lat: 41.3114, lon: -73.0846, city: "Derby", region: "New Haven Area" },
  // Bridgeport Area
  "06601": { lat: 41.1670, lon: -73.2048, city: "Bridgeport", region: "Bridgeport Area" },
  "06604": { lat: 41.1814, lon: -73.1926, city: "Bridgeport", region: "Bridgeport Area" },
  "06605": { lat: 41.1591, lon: -73.2148, city: "Bridgeport", region: "Bridgeport Area" },
  "06606": { lat: 41.1959, lon: -73.2148, city: "Bridgeport", region: "Bridgeport Area" },
  "06607": { lat: 41.1745, lon: -73.1982, city: "Bridgeport", region: "Bridgeport Area" },
  "06608": { lat: 41.1892, lon: -73.1815, city: "Bridgeport", region: "Bridgeport Area" },
  "06610": { lat: 41.2084, lon: -73.1926, city: "Bridgeport", region: "Bridgeport Area" },
  "06611": { lat: 41.2542, lon: -73.1926, city: "Trumbull", region: "Bridgeport Area" },
  "06612": { lat: 41.2681, lon: -73.2037, city: "Easton", region: "Bridgeport Area" },
  "06614": { lat: 41.2170, lon: -73.1426, city: "Stratford", region: "Bridgeport Area" },
  "06615": { lat: 41.1814, lon: -73.1370, city: "Stratford", region: "Bridgeport Area" },
  // Southwest CT
  "06824": { lat: 41.1459, lon: -73.2587, city: "Fairfield", region: "Southwest CT" },
  "06825": { lat: 41.1781, lon: -73.2365, city: "Fairfield", region: "Southwest CT" },
  "06850": { lat: 41.1197, lon: -73.4282, city: "Norwalk", region: "Southwest CT" },
  "06851": { lat: 41.1226, lon: -73.4643, city: "Norwalk", region: "Southwest CT" },
  "06853": { lat: 41.0787, lon: -73.4393, city: "Norwalk", region: "Southwest CT" },
  "06854": { lat: 41.1087, lon: -73.4199, city: "Norwalk", region: "Southwest CT" },
  "06855": { lat: 41.1198, lon: -73.3893, city: "Norwalk", region: "Southwest CT" },
  "06870": { lat: 41.0343, lon: -73.5799, city: "Old Greenwich", region: "Southwest CT" },
  "06877": { lat: 41.1031, lon: -73.5965, city: "Ridgefield", region: "Southwest CT" },
  "06878": { lat: 41.0670, lon: -73.5671, city: "Riverside", region: "Southwest CT" },
  "06880": { lat: 41.1431, lon: -73.3632, city: "Westport", region: "Southwest CT" },
  "06883": { lat: 41.1753, lon: -73.3846, city: "Weston", region: "Southwest CT" },
  "06890": { lat: 41.1509, lon: -73.3282, city: "Southport", region: "Southwest CT" },
  "06896": { lat: 41.2059, lon: -73.3893, city: "Redding", region: "Southwest CT" },
  "06897": { lat: 41.2087, lon: -73.3726, city: "Wilton", region: "Southwest CT" },
  "06820": { lat: 41.0598, lon: -73.6282, city: "Darien", region: "Southwest CT" },
  // Stamford / Greenwich
  "06830": { lat: 41.0217, lon: -73.6282, city: "Greenwich", region: "Southwest CT" },
  "06831": { lat: 41.0703, lon: -73.6393, city: "Greenwich", region: "Southwest CT" },
  "06840": { lat: 41.0409, lon: -73.7221, city: "New Canaan", region: "Southwest CT" },
  "06901": { lat: 41.0534, lon: -73.5387, city: "Stamford", region: "Southwest CT" },
  "06902": { lat: 41.0487, lon: -73.5221, city: "Stamford", region: "Southwest CT" },
  "06903": { lat: 41.1045, lon: -73.5554, city: "Stamford", region: "Southwest CT" },
  "06905": { lat: 41.0762, lon: -73.5499, city: "Stamford", region: "Southwest CT" },
  "06906": { lat: 41.0609, lon: -73.5276, city: "Stamford", region: "Southwest CT" },
  "06907": { lat: 41.0956, lon: -73.5387, city: "Stamford", region: "Southwest CT" },
  // Danbury Area
  "06810": { lat: 41.3948, lon: -73.4538, city: "Danbury", region: "Danbury Area" },
  "06811": { lat: 41.4226, lon: -73.4760, city: "Danbury", region: "Danbury Area" },
  "06812": { lat: 41.4643, lon: -73.4760, city: "Danbury", region: "Danbury Area" },
  // Waterbury Area
  "06701": { lat: 41.5582, lon: -73.0515, city: "Waterbury", region: "Waterbury Area" },
  "06702": { lat: 41.5440, lon: -73.0349, city: "Waterbury", region: "Waterbury Area" },
  "06704": { lat: 41.5809, lon: -73.0349, city: "Waterbury", region: "Waterbury Area" },
  "06705": { lat: 41.5361, lon: -73.0182, city: "Waterbury", region: "Waterbury Area" },
  "06706": { lat: 41.5250, lon: -73.0737, city: "Waterbury", region: "Waterbury Area" },
  "06708": { lat: 41.5470, lon: -73.1237, city: "Watertown", region: "Waterbury Area" },
  "06710": { lat: 41.5692, lon: -73.0626, city: "Waterbury", region: "Waterbury Area" },
  // Lower Westchester
  "10601": { lat: 41.0340, lon: -73.7629, city: "White Plains", region: "Lower Westchester" },
  "10605": { lat: 41.0195, lon: -73.7737, city: "White Plains", region: "Lower Westchester" },
  "10701": { lat: 40.9312, lon: -73.8960, city: "Yonkers", region: "Lower Westchester" },
  "10710": { lat: 40.9812, lon: -73.8557, city: "Yonkers", region: "Lower Westchester" },

  // Manhattan
  "10001": { lat: 40.7505, lon: -73.9971, city: "Manhattan", region: "Manhattan" },
  "10011": { lat: 40.7405, lon: -74.0007, city: "Manhattan", region: "Manhattan" },
  "10023": { lat: 40.7769, lon: -73.9822, city: "Manhattan", region: "Manhattan" },
  "10025": { lat: 40.7975, lon: -73.9662, city: "Manhattan", region: "Manhattan" },
  "10128": { lat: 40.7808, lon: -73.9505, city: "Manhattan", region: "Manhattan" },

  // Brooklyn
  "11201": { lat: 40.6950, lon: -73.9903, city: "Brooklyn", region: "Brooklyn" },
  "11211": { lat: 40.7143, lon: -73.9563, city: "Brooklyn", region: "Brooklyn" },
  "11215": { lat: 40.6673, lon: -73.9854, city: "Brooklyn", region: "Brooklyn" },
  "11221": { lat: 40.6912, lon: -73.9276, city: "Brooklyn", region: "Brooklyn" },
  "11234": { lat: 40.6167, lon: -73.9235, city: "Brooklyn", region: "Brooklyn" },

  // Queens
  "11101": { lat: 40.7447, lon: -73.9485, city: "Queens", region: "Queens" },
  "11354": { lat: 40.7674, lon: -73.8300, city: "Queens", region: "Queens" },
  "11375": { lat: 40.7220, lon: -73.8448, city: "Queens", region: "Queens" },
  "11434": { lat: 40.6764, lon: -73.7823, city: "Queens", region: "Queens" },
  "11691": { lat: 40.6010, lon: -73.7566, city: "Queens", region: "Queens" },

  // Bronx
  "10451": { lat: 40.8200, lon: -73.9259, city: "Bronx", region: "Bronx" },
  "10458": { lat: 40.8626, lon: -73.8901, city: "Bronx", region: "Bronx" },
  "10466": { lat: 40.8912, lon: -73.8480, city: "Bronx", region: "Bronx" },
  "10467": { lat: 40.8776, lon: -73.8687, city: "Bronx", region: "Bronx" },

  // Westchester (beyond the Southwest CT-adjacent Lower Westchester cluster)
  "10552": { lat: 40.9165, lon: -73.8288, city: "Mount Vernon", region: "Westchester" },
  "10801": { lat: 40.9115, lon: -73.7823, city: "New Rochelle", region: "Westchester" },
  "10528": { lat: 40.9601, lon: -73.7132, city: "Rye", region: "Westchester" },
  "10583": { lat: 41.0084, lon: -73.8154, city: "Scarsdale", region: "Westchester" },
  "10566": { lat: 41.2887, lon: -73.9223, city: "Peekskill", region: "Westchester" },

  // Newark
  "07102": { lat: 40.7357, lon: -74.1724, city: "Newark", region: "Newark" },
  "07103": { lat: 40.7282, lon: -74.1990, city: "Newark", region: "Newark" },
  "07104": { lat: 40.7645, lon: -74.1748, city: "Newark", region: "Newark" },
  "07107": { lat: 40.7568, lon: -74.1935, city: "Newark", region: "Newark" },
  "07108": { lat: 40.7239, lon: -74.2029, city: "Newark", region: "Newark" },

  // Jersey City
  "07302": { lat: 40.7178, lon: -74.0431, city: "Jersey City", region: "Jersey City" },
  "07304": { lat: 40.7096, lon: -74.0776, city: "Jersey City", region: "Jersey City" },
  "07305": { lat: 40.6890, lon: -74.0865, city: "Jersey City", region: "Jersey City" },
  "07306": { lat: 40.7326, lon: -74.0640, city: "Jersey City", region: "Jersey City" },
  "07310": { lat: 40.7255, lon: -74.0349, city: "Jersey City", region: "Jersey City" },

  // Princeton
  "08540": { lat: 40.3573, lon: -74.6672, city: "Princeton", region: "Princeton" },
  "08542": { lat: 40.3487, lon: -74.6593, city: "Princeton", region: "Princeton" },
  "08536": { lat: 40.3226, lon: -74.5460, city: "Plainsboro", region: "Princeton" },

  // Cherry Hill
  "08002": { lat: 39.9376, lon: -75.0296, city: "Cherry Hill", region: "Cherry Hill" },
  "08003": { lat: 39.8993, lon: -74.9718, city: "Cherry Hill", region: "Cherry Hill" },
  "08034": { lat: 39.9037, lon: -75.0621, city: "Cherry Hill", region: "Cherry Hill" },

  // Meadowlands area (East Rutherford / Secaucus / Lyndhurst / Carlstadt)
  "07072": { lat: 40.8401, lon: -74.0907, city: "Carlstadt", region: "Meadowlands" },
  "07073": { lat: 40.8123, lon: -74.0765, city: "East Rutherford", region: "Meadowlands" },
  "07094": { lat: 40.7895, lon: -74.0565, city: "Secaucus", region: "Meadowlands" },
  "07071": { lat: 40.8123, lon: -74.1090, city: "Lyndhurst", region: "Meadowlands" },

  // Baltimore area (212xx + nearby)
  "21201": { lat: 39.2904, lon: -76.6122, city: "Baltimore", region: "Baltimore" },
  "21202": { lat: 39.2969, lon: -76.6088, city: "Baltimore", region: "Baltimore" },
  "21211": { lat: 39.3298, lon: -76.6300, city: "Baltimore", region: "Baltimore" },
  "21218": { lat: 39.3255, lon: -76.6008, city: "Baltimore", region: "Baltimore" },
  "21224": { lat: 39.2833, lon: -76.5674, city: "Baltimore", region: "Baltimore" },
  "21230": { lat: 39.2680, lon: -76.6250, city: "Baltimore", region: "Baltimore" },
  "21215": { lat: 39.3440, lon: -76.6800, city: "Baltimore", region: "Baltimore" },
  "21043": { lat: 39.2500, lon: -76.8000, city: "Ellicott City", region: "Baltimore" },
  "21044": { lat: 39.2037, lon: -76.8610, city: "Columbia", region: "Baltimore" },
  "21045": { lat: 39.2100, lon: -76.8400, city: "Columbia", region: "Baltimore" },
  "21076": { lat: 39.1700, lon: -76.7000, city: "Harmans", region: "Baltimore" },
  "21077": { lat: 39.1600, lon: -76.7000, city: "Harmans", region: "Baltimore" },

  // Rockville / DC suburbs (208xx, 209xx, 206–207)
  "20850": { lat: 39.0840, lon: -77.1528, city: "Rockville", region: "Rockville/DC Suburbs" },
  "20851": { lat: 39.0762, lon: -77.1153, city: "Rockville", region: "Rockville/DC Suburbs" },
  "20852": { lat: 39.0553, lon: -77.1168, city: "Rockville", region: "Rockville/DC Suburbs" },
  "20853": { lat: 39.1000, lon: -77.1000, city: "Rockville", region: "Rockville/DC Suburbs" },
  "20854": { lat: 39.0500, lon: -77.2200, city: "Potomac", region: "Rockville/DC Suburbs" },
  "20814": { lat: 38.9896, lon: -77.0989, city: "Bethesda", region: "Rockville/DC Suburbs" },
  "20815": { lat: 38.9860, lon: -77.0900, city: "Chevy Chase", region: "Rockville/DC Suburbs" },
  "20816": { lat: 38.9556, lon: -77.1102, city: "Bethesda", region: "Rockville/DC Suburbs" },
  "20817": { lat: 39.0032, lon: -77.1276, city: "Bethesda", region: "Rockville/DC Suburbs" },
  "20901": { lat: 39.0034, lon: -77.0199, city: "Silver Spring", region: "Rockville/DC Suburbs" },
  "20902": { lat: 39.0403, lon: -77.0553, city: "Silver Spring", region: "Rockville/DC Suburbs" },
  "20910": { lat: 38.9959, lon: -77.0281, city: "Silver Spring", region: "Rockville/DC Suburbs" },
  "20705": { lat: 39.0400, lon: -76.9100, city: "Beltsville", region: "Rockville/DC Suburbs" },
  "20740": { lat: 38.9900, lon: -76.9300, city: "College Park", region: "Rockville/DC Suburbs" },
  "20770": { lat: 39.0000, lon: -76.8800, city: "Greenbelt", region: "Rockville/DC Suburbs" },
  "20794": { lat: 39.1500, lon: -76.7800, city: "Jessup", region: "Rockville/DC Suburbs" },
  "20601": { lat: 38.6400, lon: -76.9000, city: "Waldorf", region: "Rockville/DC Suburbs" },

  // Annapolis (214xx)
  "21401": { lat: 38.9784, lon: -76.4922, city: "Annapolis", region: "Annapolis" },
  "21403": { lat: 38.9506, lon: -76.4930, city: "Annapolis", region: "Annapolis" },
  "21409": { lat: 39.0198, lon: -76.4577, city: "Annapolis", region: "Annapolis" },
};

// Broad prefix-range fallback so any CT/NY/NJ/MD zip that isn't an exact
// or 3-digit match still buckets into the nearest named hub above.
// Ranges: CT 060xx-069xx, NY 100xx-149xx, NJ 070xx-089xx, MD 206xx-219xx.
const PREFIX_FALLBACK_RANGES: Array<{ min: number; max: number; zip: string }> = [
  // CT 060xx-069xx
  { min: 60, max: 61, zip: "06101" }, // Hartford Metro
  { min: 62, max: 63, zip: "06510" }, // Eastern CT -> New Haven Area
  { min: 64, max: 64, zip: "06510" }, // Shoreline / Valley -> New Haven Area
  { min: 65, max: 65, zip: "06510" }, // New Haven Area
  { min: 66, max: 66, zip: "06601" }, // Bridgeport Area
  { min: 67, max: 67, zip: "06701" }, // Waterbury Area
  { min: 68, max: 68, zip: "06810" }, // Danbury / Southwest CT (0681x → Danbury)
  { min: 69, max: 69, zip: "06901" }, // Stamford / Southwest CT

  // NY 100xx-149xx
  { min: 100, max: 102, zip: "10001" }, // Manhattan
  { min: 103, max: 103, zip: "10001" }, // Staten Island -> Manhattan
  { min: 104, max: 104, zip: "10451" }, // Bronx
  { min: 105, max: 109, zip: "10552" }, // Westchester
  { min: 110, max: 111, zip: "11101" }, // Queens
  { min: 112, max: 112, zip: "11201" }, // Brooklyn
  { min: 113, max: 114, zip: "11375" }, // Queens
  { min: 116, max: 116, zip: "11691" }, // Queens (Rockaways)
  { min: 115, max: 149, zip: "10583" }, // Long Island / upstate NY -> Westchester

  // NJ 070xx-089xx
  { min: 70, max: 70, zip: "07073" }, // Meadowlands / North Hudson
  { min: 71, max: 71, zip: "07102" }, // Newark
  { min: 72, max: 72, zip: "07073" }, // Meadowlands corridor
  { min: 73, max: 73, zip: "07302" }, // Jersey City
  { min: 74, max: 79, zip: "07073" }, // North Jersey -> Meadowlands
  { min: 85, max: 85, zip: "08540" }, // Princeton
  { min: 80, max: 84, zip: "08002" }, // South Jersey -> Cherry Hill
  { min: 86, max: 89, zip: "08002" }, // Central/South Jersey -> Cherry Hill

  // MD 206xx-219xx → three hubs (Baltimore / Rockville-DC / Annapolis)
  { min: 206, max: 209, zip: "20850" }, // Rockville / DC suburbs
  { min: 210, max: 213, zip: "21201" }, // Baltimore area
  { min: 214, max: 214, zip: "21401" }, // Annapolis
  { min: 215, max: 219, zip: "21201" }, // Rest of MD → Baltimore
];

function resolveZipPrefixFallback(clean: string): ZipInfo | null {
  const num3 = Number(clean.slice(0, 3));
  for (const r of PREFIX_FALLBACK_RANGES) {
    if (num3 >= r.min && num3 <= r.max) return ZIP_INFO[r.zip] ?? null;
  }
  return null;
}

// Map profiles.nearest_venue → a representative ZIP so members without a
// zip_code still land in the correct city/region cluster.
const VENUE_TO_ZIP: Record<string, string> = {
  "Sofive Meadowlands": "07072",
  "Sofive Meadowlands 5v5": "07072",
  "Sofive Meadowlands 7v7": "07072",
  "Sofive Cherry Hill": "08034",
  "Sofive Cherry Hill 5v5": "08034",
  "Sofive Cherry Hill 7v7": "08034",
  "Sofive Brooklyn": "11201",
  "Hudson Sports Complex": "10990",
  "Hudson Sports": "10990",
  "New Rochelle SoccerRoof": "10801",
  "New Rochelle": "10801",
  "Sofive Rockville": "20850",
  "Sofive Columbia": "21044",
  "SoccerDome Jessup": "20794",
  "SoccerDome Harmans": "21077",
  "Baltimore SoccerRoof": "21201",
  "DC SoccerRoof": "20910",
  "New Haven SoccerRoof": "06510",
};

function resolveVenue(venue: string | null | undefined): ZipInfo | null {
  if (venue == null) return null;
  const key = String(venue).trim();
  if (!key) return null;
  const zip = VENUE_TO_ZIP[key];
  return zip ? (ZIP_INFO[zip] ?? resolveZipPrefixFallback(zip)) : null;
}

function resolveMemberArea(
  zipCode: string | null | undefined,
  nearestVenue: string | null | undefined,
): ZipInfo | null {
  const fromZip = resolveZip(String(zipCode ?? ""));
  if (fromZip) return fromZip;
  return resolveVenue(nearestVenue);
}

// Pre-compute city centroids (average of all ZIPs per city)
const CITY_CENTER = (() => {
  const acc: Record<string, { lat: number; lon: number; n: number; region: string }> = {};
  for (const info of Object.values(ZIP_INFO)) {
    if (!acc[info.city]) acc[info.city] = { lat: 0, lon: 0, n: 0, region: info.region };
    acc[info.city].lat += info.lat;
    acc[info.city].lon += info.lon;
    acc[info.city].n++;
  }
  const out: Record<string, { lat: number; lon: number; region: string }> = {};
  for (const [city, v] of Object.entries(acc)) {
    out[city] = { lat: v.lat / v.n, lon: v.lon / v.n, region: v.region };
  }
  return out;
})();

/**
 * Mega-clusters shown when latitudeDelta >= MACRO_LAT_DELTA.
 * Nearby overlapping sub-regions (within ~50 mi of each other) collapse into one pin.
 */
const MACRO_CLUSTERS: Array<{
  name: string;
  lat: number;
  lon: number;
  regions: string[];
}> = [
  {
    name: "Northeast CT/NY",
    lat: 40.95,
    lon: -73.75,
    regions: [
      "Southwest CT",
      "Lower Westchester",
      "Westchester",
      "Manhattan",
      "Bronx",
      "Queens",
      "Brooklyn",
    ],
  },
  {
    name: "Connecticut",
    lat: 41.45,
    lon: -72.90,
    regions: [
      "Hartford Metro",
      "New Haven Area",
      "Waterbury Area",
      "Danbury Area",
      "Bridgeport Area",
    ],
  },
  {
    name: "New Jersey",
    lat: 40.45,
    lon: -74.40,
    regions: ["Newark", "Jersey City", "Princeton", "Cherry Hill", "Meadowlands"],
  },
  {
    name: "Maryland",
    lat: 39.15,
    lon: -76.75,
    regions: ["Baltimore", "Rockville/DC Suburbs", "Annapolis"],
  },
];

const REGION_TO_MACRO: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const m of MACRO_CLUSTERS) {
    for (const r of m.regions) out[r] = m.name;
  }
  return out;
})();

function resolveZip(zip: string): ZipInfo | null {
  const digits = String(zip ?? "").replace(/\D/g, "");
  if (!digits) return null;
  // Pad leading zeros so NJ/CT zips like "7102" / "6101" resolve correctly.
  const clean = digits.length <= 5 ? digits.padStart(5, "0") : digits.slice(0, 5);
  if (ZIP_INFO[clean]) return ZIP_INFO[clean];
  const prefix = clean.slice(0, 3);
  for (const [z, info] of Object.entries(ZIP_INFO)) {
    if (z.startsWith(prefix)) return info;
  }
  return resolveZipPrefixFallback(clean);
}

const COS_REF = Math.cos((41.3 * Math.PI) / 180); // ≈ 0.748

function distSq(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = aLat - bLat;
  const dLon = (aLon - bLon) * COS_REF;
  return dLat * dLat + dLon * dLon;
}

// ─── sizing & color helpers ──────────────────────────────────────────────────

function circleSize(count: number): number {
  if (count >= 151) return 100;
  if (count >= 51)  return 80;
  if (count >= 16)  return 60;
  return 40;
}

function circleBg(count: number): string {
  if (count >= 150) return LIME;
  if (count >= 50)  return "rgba(163,230,53,0.80)";
  if (count >= 10)  return GREEN_MED;
  return "#3a3a3a";
}

function circleTextColor(count: number): string {
  return count >= 50 ? BG : CHALK;
}

function circleCountColor(count: number): string {
  // On dark backgrounds (< 50), count is lime; on lime backgrounds, count is dark
  return count >= 50 ? BG : LIME;
}

// ─── personality label ───────────────────────────────────────────────────────

function personalityLabel(cell: CityCell): string | null {
  if (cell.count >= 150) return "🔥 Hotspot";
  if (cell.count >= 50 && cell.newThisMonth > 10) return "🚀 Growing";
  if (cell.diamondCount >= 30) return "👑 Elite Hub";
  if (cell.firstSeen) {
    const threeMonthsAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
    if (new Date(cell.firstSeen).getTime() > threeMonthsAgo) return "⚡ New Community";
  }
  return null;
}

// ─── types ───────────────────────────────────────────────────────────────────

type Layer = "members" | "sessions" | "activity";

type CityCell = {
  city: string;
  region: string;
  lat: number;
  lon: number;
  count: number;
  diamondCount: number;
  goldPlusCount: number;
  newThisMonth: number;
  activeThisWeek: number;
  sessionsThisWeek: number;
  firstSeen: string | null;
};

type RegionalCluster = {
  name: string;
  lat: number;
  lon: number;
  count: number;
};

type SessionPin = {
  id: string;
  latitude: number;
  longitude: number;
  level: string | null;
  spots_taken: number;
  capacity: number;
  start_at: string;
  location_private: string | null;
  fee_cents: number;
};

type ActivityStats = {
  recentlyActiveCount: number;
  soonCount: number;
  totalApproved: number;
};

// ─── hooks ───────────────────────────────────────────────────────────────────

function useCommunityData() {
  const { supabase } = useAuth();
  const [cities, setCities] = useState<CityCell[]>([]);
  const [macroClusters, setMacroClusters] = useState<RegionalCluster[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);

    const now = Date.now();
    const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    const weekAgo  = new Date(now - 7  * 24 * 60 * 60 * 1000).toISOString();
    const weekNext = new Date(now + 7  * 24 * 60 * 60 * 1000).toISOString();

    const [
      { data: profiles },
      { data: ratings },
      { data: sessionRuns },
    ] = await Promise.all([
      // Fetch ALL approved profiles — no geographic / zip filters.
      supabase
        .from("profiles")
        .select("id, zip_code, nearest_venue, created_at, updated_at")
        .eq("approved", true),
      supabase
        .from("player_ratings")
        .select("user_id, tier"),
      supabase
        .from("pickup_runs")
        .select("latitude,longitude,start_at")
        .in("status", ["planning", "likely_on", "active", "in_progress"])
        .gte("start_at", weekAgo)
        .lte("start_at", weekNext)
        .not("latitude", "is", null)
        .not("longitude", "is", null)
        .limit(200),
    ]);

    // Tier lookup
    const tierByUser = new Map<string, string>();
    for (const r of ratings ?? []) {
      if (r.user_id && r.tier) tierByUser.set(r.user_id, (r.tier as string).toLowerCase());
    }

    // City aggregation — every resolvable approved member counts
    type CityAgg = {
      region: string;
      count: number; diamondCount: number; goldPlusCount: number;
      newThisMonth: number; activeThisWeek: number;
      sessionsThisWeek: number; firstSeen: string | null;
    };
    const cityMap = new Map<string, CityAgg>();

    for (const p of profiles ?? []) {
      const info = resolveMemberArea(
        p.zip_code as string | null,
        p.nearest_venue as string | null,
      );
      if (!info) continue;
      const city = info.city;

      if (!cityMap.has(city)) {
        cityMap.set(city, {
          region: info.region,
          count: 0, diamondCount: 0, goldPlusCount: 0,
          newThisMonth: 0, activeThisWeek: 0,
          sessionsThisWeek: 0, firstSeen: null,
        });
      }
      const agg = cityMap.get(city)!;
      agg.count++;

      const tier = tierByUser.get(p.id as string) ?? "";
      if (tier === "diamond") { agg.diamondCount++; agg.goldPlusCount++; }
      else if (tier === "platinum" || tier === "gold") { agg.goldPlusCount++; }

      const createdAt = p.created_at as string | null;
      if (createdAt && (agg.firstSeen === null || createdAt < agg.firstSeen)) {
        agg.firstSeen = createdAt;
      }
      if (createdAt && createdAt >= monthAgo) agg.newThisMonth++;

      const updatedAt = p.updated_at as string | null;
      if (updatedAt && updatedAt >= weekAgo) agg.activeThisWeek++;
    }

    // Assign sessions to nearest city (within ~20 km, ≈ 0.18°)
    const SESSION_RADIUS_SQ = 0.18 * 0.18;
    for (const run of sessionRuns ?? []) {
      const lat = run.latitude as number;
      const lon = run.longitude as number;
      let bestCity: string | null = null;
      let bestD = SESSION_RADIUS_SQ;
      for (const [city, c] of Object.entries(CITY_CENTER)) {
        const d = distSq(lat, lon, c.lat, c.lon);
        if (d < bestD) { bestD = d; bestCity = city; }
      }
      if (bestCity && cityMap.has(bestCity)) {
        cityMap.get(bestCity)!.sessionsThisWeek++;
      }
    }

    // City markers (min 5 members for privacy on the map)
    const cityResult: CityCell[] = [];
    // Sub-region totals include EVERY resolved member (feeds macro clusters).
    const regionMap = new Map<string, number>();

    for (const [city, agg] of cityMap.entries()) {
      regionMap.set(agg.region, (regionMap.get(agg.region) ?? 0) + agg.count);

      if (agg.count < 5) continue;
      const center = CITY_CENTER[city];
      if (!center) continue;
      cityResult.push({
        city,
        region: center.region,
        lat: center.lat,
        lon: center.lon,
        count: agg.count,
        diamondCount: agg.diamondCount,
        goldPlusCount: agg.goldPlusCount,
        newThisMonth: agg.newThisMonth,
        activeThisWeek: agg.activeThisWeek,
        sessionsThisWeek: agg.sessionsThisWeek,
        firstSeen: agg.firstSeen,
      });
    }

    // Mega-clusters for zoomed-out view (no overlapping nearby pins)
    const macroCounts = new Map<string, number>();
    for (const [region, count] of regionMap.entries()) {
      const macro = REGION_TO_MACRO[region];
      if (!macro) continue;
      macroCounts.set(macro, (macroCounts.get(macro) ?? 0) + count);
    }
    const macroResult: RegionalCluster[] = [];
    for (const def of MACRO_CLUSTERS) {
      const count = macroCounts.get(def.name) ?? 0;
      if (count < 1) continue;
      macroResult.push({ name: def.name, lat: def.lat, lon: def.lon, count });
    }

    setCities(cityResult);
    setMacroClusters(macroResult);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  return { cities, macroClusters, loading, reload: load };
}

function useSessionPins() {
  const { supabase } = useAuth();
  const [sessions, setSessions] = useState<SessionPin[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) return;
    setLoading(true);
    void (async () => {
      const { data } = await supabase
        .from("pickup_runs")
        .select("id,latitude,longitude,level,spots_taken,capacity,start_at,location_private,fee_cents")
        .in("status", ["planning", "likely_on", "active", "in_progress"])
        .gte("start_at", new Date().toISOString())
        .not("latitude", "is", null)
        .not("longitude", "is", null)
        .order("start_at", { ascending: true })
        .limit(60);
      if (data) setSessions(data as SessionPin[]);
      setLoading(false);
    })();
  }, [supabase]);

  return { sessions, loading };
}

function useActivityStats() {
  const { supabase } = useAuth();
  const [stats, setStats] = useState<ActivityStats | null>(null);

  useEffect(() => {
    if (!supabase) return;
    void (async () => {
      const now = new Date();
      const dayAgo  = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const sixHrs  = new Date(now.getTime() + 6  * 60 * 60 * 1000).toISOString();

      const [
        { count: recentlyActiveCount },
        { count: soonCount },
        { count: totalApproved },
      ] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("approved", true).gte("updated_at", dayAgo),
        supabase.from("pickup_runs").select("id", { count: "exact", head: true }).in("status", ["planning", "likely_on", "active"]).gte("start_at", now.toISOString()).lte("start_at", sixHrs),
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("approved", true),
      ]);

      setStats({
        recentlyActiveCount: recentlyActiveCount ?? 0,
        soonCount: soonCount ?? 0,
        totalApproved: totalApproved ?? 0,
      });
    })();
  }, [supabase]);

  return stats;
}

// ─── city circle marker ──────────────────────────────────────────────────────

function CityCircleMarker({
  cell,
  onPress,
}: {
  cell: CityCell;
  onPress: () => void;
}) {
  const sz = circleSize(cell.count);
  const bg = circleBg(cell.count);
  const textCol = circleTextColor(cell.count);
  const countCol = circleCountColor(cell.count);
  const hasPulse = cell.count >= 50;
  const outerSz = sz + (hasPulse ? 18 : 0);

  // Pulse animation for 50+ members
  const pulseScale = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0.4)).current;
  const [tracking, setTracking] = useState(true);

  useEffect(() => {
    if (!hasPulse) {
      // Standard pattern: brief tracking then freeze
      const t = setTimeout(() => setTracking(false), 400);
      return () => clearTimeout(t);
    }
    // Animated circles stay tracking so the pulse is visible
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulseScale, { toValue: 1.18, duration: 1100, useNativeDriver: true }),
          Animated.timing(pulseScale, { toValue: 1.0,  duration: 1100, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(pulseOpacity, { toValue: 0.0, duration: 1100, useNativeDriver: true }),
          Animated.timing(pulseOpacity, { toValue: 0.4, duration: 1100, useNativeDriver: true }),
        ]),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [hasPulse, pulseScale, pulseOpacity]);

  // City name font size scales with circle
  const cityFontSize = sz >= 80 ? 10 : sz >= 60 ? 9 : 8;
  const countFontSize = sz >= 80 ? 16 : sz >= 60 ? 14 : 12;
  const showCityLabel = sz >= 40;

  return (
    <Marker
      coordinate={{ latitude: cell.lat, longitude: cell.lon }}
      onPress={onPress}
      tracksViewChanges={tracking}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={cell.count}
    >
      <View
        style={{ width: outerSz, height: outerSz, alignItems: "center", justifyContent: "center" }}
      >
        {/* Pulse ring */}
        {hasPulse && (
          <Animated.View
            style={{
              position: "absolute",
              width: outerSz,
              height: outerSz,
              borderRadius: outerSz / 2,
              backgroundColor: bg,
              opacity: pulseOpacity,
              transform: [{ scale: pulseScale }],
            }}
          />
        )}

        {/* Main circle */}
        <View
          style={{
            width: sz,
            height: sz,
            borderRadius: sz / 2,
            backgroundColor: bg,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1.5,
            borderColor: "rgba(255,255,255,0.22)",
          }}
        >
          {showCityLabel && (
            <Text
              style={{
                color: textCol,
                fontSize: cityFontSize,
                fontWeight: "700",
                lineHeight: cityFontSize + 3,
                textAlign: "center",
                paddingHorizontal: 2,
              }}
              allowFontScaling={false}
              numberOfLines={1}
            >
              {cell.city}
            </Text>
          )}
          <Text
            style={{
              color: countCol,
              fontSize: countFontSize,
              fontWeight: "800",
              lineHeight: countFontSize + 2,
            }}
            allowFontScaling={false}
          >
            {cell.count}
          </Text>
        </View>
      </View>
    </Marker>
  );
}

// ─── regional cluster marker ─────────────────────────────────────────────────

function RegionalClusterMarker({
  cluster,
  onPress,
}: {
  cluster: RegionalCluster;
  onPress: () => void;
}) {
  const sz = cluster.count >= 150 ? 90 : cluster.count >= 50 ? 70 : 54;
  const bg = circleBg(cluster.count);
  const textCol = circleTextColor(cluster.count);
  const countCol = circleCountColor(cluster.count);

  const [tracking, setTracking] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setTracking(false), 400);
    return () => clearTimeout(t);
  }, []);

  // Shorten region name for display
  const label = cluster.name.replace("Metro", "").replace("Area", "").replace("Lower ", "").trim();
  const countLabel = cluster.count >= 1000 ? `${(cluster.count / 1000).toFixed(1)}k` : String(cluster.count);

  return (
    <Marker
      coordinate={{ latitude: cluster.lat, longitude: cluster.lon }}
      onPress={onPress}
      tracksViewChanges={tracking}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={cluster.count}
    >
      <View
        style={{
          width: sz, height: sz, borderRadius: sz / 2,
          backgroundColor: bg,
          alignItems: "center", justifyContent: "center",
          borderWidth: 2, borderColor: "rgba(255,255,255,0.25)",
        }}
      >
        <Text style={{ color: textCol, fontSize: 9, fontWeight: "700", textAlign: "center", paddingHorizontal: 4 }} allowFontScaling={false} numberOfLines={2}>
          {label}
        </Text>
        <Text style={{ color: countCol, fontSize: 18, fontWeight: "800" }} allowFontScaling={false}>
          {countLabel}
        </Text>
      </View>
    </Marker>
  );
}

// ─── session marker ──────────────────────────────────────────────────────────

function SessionMarker({
  session,
  selected,
  onPress,
}: {
  session: SessionPin;
  selected: boolean;
  onPress: () => void;
}) {
  const left = session.capacity - session.spots_taken;
  const full  = left <= 0;
  const sz    = selected ? 52 : 44;
  const r     = sz / 2 - 4;
  const circ  = 2 * Math.PI * r;
  const pct   = Math.min(session.spots_taken / session.capacity, 1);
  const color = full ? MUTED : LIME;

  const [tracking, setTracking] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setTracking(false), 400);
    return () => clearTimeout(t);
  }, []);

  return (
    <Marker
      coordinate={{ latitude: session.latitude, longitude: session.longitude }}
      onPress={onPress}
      tracksViewChanges={tracking}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={selected ? 99 : 1}
    >
      <View style={{ width: sz, height: sz }}>
        <Svg width={sz} height={sz} style={StyleSheet.absoluteFill}>
          <Circle cx={sz / 2} cy={sz / 2} r={r} fill={SURFACE} />
          <Circle cx={sz / 2} cy={sz / 2} r={r} stroke={HAIRLINE} strokeWidth={2} fill="none" />
          <Circle
            cx={sz / 2} cy={sz / 2} r={r}
            stroke={color} strokeWidth={3} fill="none"
            strokeDasharray={`${circ * pct} ${circ}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${sz / 2} ${sz / 2})`}
          />
        </Svg>
        <View style={s.pinCenter}>
          <Text style={[s.pinNum, { color: full ? MUTED : CHALK }]} allowFontScaling={false}>
            {full ? "—" : left}
          </Text>
        </View>
      </View>
    </Marker>
  );
}

// ─── city popup card ─────────────────────────────────────────────────────────

function CityPopupCard({ cell, onClose }: { cell: CityCell; onClose: () => void }) {
  const label = personalityLabel(cell);

  return (
    <View style={s.popupCard}>
      <View style={s.popupHeader}>
        <View style={{ flex: 1, marginRight: 10 }}>
          <Text style={s.popupCity}>{cell.city}</Text>
          {label ? (
            <Text style={s.popupLabel}>{label}</Text>
          ) : (
            <Text style={s.popupSub}>{cell.region}</Text>
          )}
        </View>
        <Pressable onPress={onClose} hitSlop={12} style={s.popupClose}>
          <Text style={s.popupCloseText}>✕</Text>
        </Pressable>
      </View>

      <View style={s.popupRows}>
        <PopupRow icon="👥" label={`${cell.count} members`} />
        <PopupRow icon="⚽" label={`${cell.sessionsThisWeek} upcoming sessions`} />
        <PopupRow icon="💎" label={`${cell.diamondCount} Diamond players`} />
        {cell.newThisMonth > 0 && (
          <PopupRow icon="📈" label={`+${cell.newThisMonth} new this month`} accent={LIME} />
        )}
      </View>

      {cell.count < 15 && (
        <Text style={s.privacyNote}>
          Exact breakdowns hidden to protect player privacy.
        </Text>
      )}
    </View>
  );
}

function PopupRow({ icon, label, accent }: { icon: string; label: string; accent?: string }) {
  return (
    <View style={s.popupRow}>
      <Text style={s.popupRowIcon}>{icon}</Text>
      <Text style={[s.popupRowText, accent ? { color: accent } : null]}>{label}</Text>
    </View>
  );
}

// ─── session detail card ──────────────────────────────────────────────────────

function SessionDetailCard({
  session,
  onClose,
  onNavigate,
}: {
  session: SessionPin;
  onClose: () => void;
  onNavigate: () => void;
}) {
  const left = session.capacity - session.spots_taken;
  const full  = left <= 0;
  const d     = new Date(session.start_at);
  const when  = isToday(d)
    ? `Today · ${format(d, "h:mm a")}`
    : isTomorrow(d)
      ? `Tomorrow · ${format(d, "h:mm a")}`
      : `${format(d, "EEE MMM d")} · ${format(d, "h:mm a")}`;

  return (
    <View style={s.popupCard}>
      <View style={s.popupHeader}>
        <View style={{ flex: 1, marginRight: 10 }}>
          <Text style={s.popupCity} numberOfLines={1}>
            {session.location_private?.trim() || "Location TBD"}
          </Text>
          <Text style={s.popupSub}>{when}</Text>
        </View>
        <Pressable onPress={onClose} hitSlop={12} style={s.popupClose}>
          <Text style={s.popupCloseText}>✕</Text>
        </Pressable>
      </View>

      <View style={s.popupRows}>
        <PopupRow icon="👥" label={`${session.capacity} capacity`} />
        <PopupRow icon="🎟" label={full ? "Full — join waitlist" : `${left} spots left`} accent={full ? MUTED : LIME} />
        <PopupRow icon="💵" label={`$${(session.fee_cents / 100).toFixed(0)} entry`} />
      </View>

      <Pressable style={s.popupCta} onPress={onNavigate}>
        <Text style={s.popupCtaText}>{full ? "View Waitlist →" : "Reserve Spot →"}</Text>
      </Pressable>
    </View>
  );
}

// ─── regional cluster popup ───────────────────────────────────────────────────

function RegionalPopupCard({ cluster, onClose }: { cluster: RegionalCluster; onClose: () => void }) {
  const isMacro = MACRO_CLUSTERS.some((m) => m.name === cluster.name);
  return (
    <View style={s.popupCard}>
      <View style={s.popupHeader}>
        <View style={{ flex: 1, marginRight: 10 }}>
          <Text style={s.popupCity}>{cluster.name}</Text>
          <Text style={s.popupSub}>
            {isMacro ? "Zoom in to see cities" : "Regional cluster — zoom in for cities"}
          </Text>
        </View>
        <Pressable onPress={onClose} hitSlop={12} style={s.popupClose}>
          <Text style={s.popupCloseText}>✕</Text>
        </Pressable>
      </View>
      <View style={s.popupRows}>
        <PopupRow icon="👥" label={`${cluster.count} members across this region`} />
      </View>
    </View>
  );
}

// ─── activity overlay ─────────────────────────────────────────────────────────

function ActivityOverlay({ stats }: { stats: ActivityStats | null }) {
  if (!stats) {
    return (
      <View style={s.activityOverlay}>
        <ActivityIndicator color={LIME} />
      </View>
    );
  }

  return (
    <View style={s.activityOverlay}>
      <Text style={s.actKicker}>LIVE COMMUNITY</Text>
      <Text style={s.actHeadline}>Region Activity</Text>

      <View style={s.actCards}>
        <ActCard value={stats.recentlyActiveCount} label="Active today" sub="Updated profile in last 24h" dot={LIME} />
        <ActCard value={stats.soonCount} label="Sessions soon" sub="Starting in next 6 hours" dot="#4ADE80" />
        <ActCard value={stats.totalApproved} label="Total members" sub="Approved CT Pickup players" dot={GREEN_MED} />
      </View>

      <Text style={s.actNote}>
        Aggregated data only — individual locations are never shown.
      </Text>
    </View>
  );
}

function ActCard({ value, label, sub, dot }: { value: number; label: string; sub: string; dot: string }) {
  return (
    <View style={s.actCard}>
      <View style={[s.actDot, { backgroundColor: dot }]} />
      <View style={{ flex: 1 }}>
        <Text style={s.actLabel}>{label}</Text>
        <Text style={s.actSub}>{sub}</Text>
      </View>
      <Text style={[s.actValue, { color: dot }]}>{value}</Text>
    </View>
  );
}

// ─── your area card ───────────────────────────────────────────────────────────

function YourAreaCard({
  cities,
  userLat,
  userLon,
  onPress,
}: {
  cities: CityCell[];
  userLat: number;
  userLon: number;
  onPress: (city: CityCell) => void;
}) {
  const nearest = useMemo(() => {
    if (cities.length === 0) return null;
    let best: CityCell | null = null;
    let bestD = Infinity;
    for (const c of cities) {
      const d = distSq(userLat, userLon, c.lat, c.lon);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }, [cities, userLat, userLon]);

  if (!nearest) return null;

  return (
    <Pressable style={s.yourArea} onPress={() => onPress(nearest)}>
      <Text style={s.yourAreaKicker}>📍 Your area</Text>
      <Text style={s.yourAreaCity}>{nearest.city}</Text>
      <Text style={s.yourAreaStat}>
        {nearest.count} members · {nearest.sessionsThisWeek} sessions this week
      </Text>
    </Pressable>
  );
}

// ─── main screen ─────────────────────────────────────────────────────────────

const LAYERS: Array<{ id: Layer; label: string }> = [
  { id: "members", label: "Members" },
  { id: "sessions", label: "Sessions" },
  { id: "activity", label: "Activity" },
];

// Approximate zoom level from latitudeDelta:  zoom ≈ log2(360 / latDelta)
function latDeltaToZoom(latDelta: number): number {
  return Math.log2(360 / Math.max(latDelta, 0.001));
}

/** ~50 miles in degrees of latitude (1° lat ≈ 69 mi). */
const MERGE_RADIUS_DEG = 50 / 69; // ≈ 0.725°
const MERGE_RADIUS_SQ = MERGE_RADIUS_DEG * MERGE_RADIUS_DEG;

/**
 * Greedy merge of nearby city cells so overlapping pins collapse when zoomed out.
 * Anything within ~50 miles of a cluster centroid joins that cluster.
 */
function mergeNearbyCities(cells: CityCell[]): RegionalCluster[] {
  type Acc = { name: string; lat: number; lon: number; count: number; n: number };
  const clusters: Acc[] = [];

  // Largest first so big hubs absorb nearby small cities
  const sorted = [...cells].sort((a, b) => b.count - a.count);
  for (const cell of sorted) {
    let bestIdx = -1;
    let bestD = MERGE_RADIUS_SQ;
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i];
      const d = distSq(cell.lat, cell.lon, c.lat, c.lon);
      if (d < bestD) { bestD = d; bestIdx = i; }
    }
    if (bestIdx >= 0) {
      const c = clusters[bestIdx];
      const total = c.count + cell.count;
      c.lat = (c.lat * c.count + cell.lat * cell.count) / total;
      c.lon = (c.lon * c.count + cell.lon * cell.count) / total;
      c.count = total;
      c.n++;
      // Keep the dominant city name for the label
    } else {
      clusters.push({
        name: cell.city,
        lat: cell.lat,
        lon: cell.lon,
        count: cell.count,
        n: 1,
      });
    }
  }

  return clusters.map(({ name, lat, lon, count }) => ({ name, lat, lon, count }));
}

export default function CommunityMapScreen() {
  const router = useRouter();
  const [layer, setLayer] = useState<Layer>("members");
  const [region, setRegion] = useState<Region>(CT_REGION);
  const [selectedCity, setSelectedCity] = useState<CityCell | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<RegionalCluster | null>(null);
  const [selectedSession, setSelectedSession] = useState<SessionPin | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
  const mapRef = useRef<MapView>(null);

  const { cities, macroClusters, loading: cityLoading } = useCommunityData();
  const { sessions, loading: sessionsLoading } = useSessionPins();
  const activityStats = useActivityStats();

  // Request location once
  useEffect(() => {
    void (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setUserLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      } catch {}
    })();
  }, []);

  const zoom = latDeltaToZoom(region.latitudeDelta);
  // latitudeDelta >= 4: 4 mega-clusters (Northeast CT/NY, Connecticut, NJ, Maryland)
  // zoom < 9 (still somewhat zoomed out): merge cities within ~50 miles
  // zoom >= 9: individual city circles
  const showMacro = region.latitudeDelta >= MACRO_LAT_DELTA;
  const showMergedCities = !showMacro && zoom < 9 && region.latitudeDelta > 0.03;
  const showCities = !showMacro && zoom >= 9 && region.latitudeDelta > 0.03;
  const showRegional = showMacro || showMergedCities;

  const mergedCityClusters = useMemo(
    () => (showMergedCities ? mergeNearbyCities(cities) : []),
    [showMergedCities, cities],
  );

  const regionalClusters = showMacro ? macroClusters : mergedCityClusters;

  const dismiss = useCallback(() => {
    setSelectedCity(null);
    setSelectedRegion(null);
    setSelectedSession(null);
  }, []);

  const handleCityPress = useCallback((cell: CityCell) => {
    dismiss();
    setSelectedCity(cell);
    mapRef.current?.animateToRegion(
      { latitude: cell.lat, longitude: cell.lon, latitudeDelta: 0.25, longitudeDelta: 0.25 },
      300,
    );
  }, [dismiss]);

  const handleRegionalPress = useCallback((cluster: RegionalCluster) => {
    dismiss();
    setSelectedRegion(cluster);
    // Zoom in past the macro threshold so cities / mid-clusters appear
    const nextDelta = showMacro ? 2.5 : 0.6;
    mapRef.current?.animateToRegion(
      { latitude: cluster.lat, longitude: cluster.lon, latitudeDelta: nextDelta, longitudeDelta: nextDelta },
      350,
    );
  }, [dismiss, showMacro]);

  const handleSessionPress = useCallback((session: SessionPin) => {
    dismiss();
    setSelectedSession(session);
  }, [dismiss]);

  const loading = layer === "members" ? cityLoading : layer === "sessions" ? sessionsLoading : false;

  const hasPopup = !!(selectedCity || selectedRegion || selectedSession);

  // Flat array of map markers
  const mapOverlays = useMemo(() => {
    if (layer === "members") {
      if (showRegional) {
        return regionalClusters.map((c) => (
          <RegionalClusterMarker key={c.name} cluster={c} onPress={() => handleRegionalPress(c)} />
        ));
      }
      if (showCities) {
        return cities.map((c) => (
          <CityCircleMarker key={c.city} cell={c} onPress={() => handleCityPress(c)} />
        ));
      }
      return [];
    }
    if (layer === "sessions") {
      return sessions.map((s) => (
        <SessionMarker
          key={s.id}
          session={s}
          selected={s.id === selectedSession?.id}
          onPress={() => handleSessionPress(s)}
        />
      ));
    }
    return [];
  }, [
    layer, showRegional, showCities,
    regionalClusters, cities, sessions, selectedSession,
    handleRegionalPress, handleCityPress, handleSessionPress,
  ]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.root}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialRegion={CT_REGION}
          userInterfaceStyle="dark"
          backgroundColor="#1a2420"
          loadingBackgroundColor="#1a2420"
          showsUserLocation
          showsMyLocationButton={false}
          showsPointsOfInterest={false}
          onRegionChangeComplete={(r) => setRegion(r)}
        >
          {mapOverlays}
        </MapView>

        {/* Tap-to-dismiss transparent overlay */}
        {hasPopup ? (
          <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} pointerEvents="box-only" />
        ) : null}

        {/* ── Top controls ─────────────────────────── */}
        <View style={s.topBar} pointerEvents="box-none">
          <Pressable onPress={() => router.back()} hitSlop={10} style={s.backBtn}>
            <Text style={s.backBtnText}>‹ Back</Text>
          </Pressable>
          <View style={s.layerToggle} pointerEvents="auto">
            {LAYERS.map(({ id, label }) => {
              const active = layer === id;
              return (
                <Pressable
                  key={id}
                  onPress={() => { setLayer(id); dismiss(); }}
                  style={[s.layerBtn, active && s.layerBtnActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[s.layerBtnText, active && s.layerBtnTextActive]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Privacy notice when zoomed in too far */}
        {layer === "members" && !showCities && !showRegional ? (
          <View style={s.privacyBanner} pointerEvents="none">
            <Text style={s.privacyBannerText}>Zoom out to see community density</Text>
          </View>
        ) : null}

        {/* Activity overlay */}
        {layer === "activity" ? <ActivityOverlay stats={activityStats} /> : null}

        {/* Loading */}
        {loading ? (
          <View style={s.loadingCenter} pointerEvents="none">
            <ActivityIndicator color={LIME} />
          </View>
        ) : null}

        {/* Your Area card — bottom-left, only on Members layer when not showing a popup */}
        {layer === "members" && !hasPopup && userLocation && showCities ? (
          <YourAreaCard
            cities={cities}
            userLat={userLocation.lat}
            userLon={userLocation.lon}
            onPress={handleCityPress}
          />
        ) : null}

        {/* Popup card */}
        {hasPopup ? (
          <View style={s.popupWrap}>
            {selectedCity ? (
              <CityPopupCard cell={selectedCity} onClose={dismiss} />
            ) : selectedRegion ? (
              <RegionalPopupCard cluster={selectedRegion} onClose={dismiss} />
            ) : selectedSession ? (
              <SessionDetailCard
                session={selectedSession}
                onClose={dismiss}
                onNavigate={() => router.push(`/session/${encodeURIComponent(selectedSession.id)}`)}
              />
            ) : null}
          </View>
        ) : null}
      </View>
    </>
  );
}

// ─── styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },

  topBar: {
    position: "absolute",
    top: 60,
    left: 0,
    right: 0,
    paddingHorizontal: 14,
    gap: 10,
  },
  backBtn: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(0,0,0,0.68)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  backBtnText: { color: CHALK, fontWeight: "600", fontSize: 15 },

  layerToggle: {
    flexDirection: "row",
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.74)",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: HAIRLINE,
    padding: 3,
    gap: 2,
  },
  layerBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999 },
  layerBtnActive: { backgroundColor: LIME },
  layerBtnText: { color: MUTED, fontWeight: "700", fontSize: 13 },
  layerBtnTextActive: { color: BG },

  pinCenter: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  pinNum: { fontSize: 15, fontWeight: "700" },

  privacyBanner: {
    position: "absolute",
    bottom: 220,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.72)",
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: HAIRLINE,
  },
  privacyBannerText: { color: MUTED, fontSize: 13 },

  loadingCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },

  // Your Area card
  yourArea: {
    position: "absolute",
    bottom: 34,
    left: 14,
    backgroundColor: "rgba(11,15,13,0.90)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: HAIRLINE,
    padding: 12,
    maxWidth: 180,
  },
  yourAreaKicker: { color: MUTED, fontSize: 10, fontWeight: "700", letterSpacing: 1, marginBottom: 3 },
  yourAreaCity: { color: CHALK, fontSize: 16, fontWeight: "800" },
  yourAreaStat: { color: MUTED, fontSize: 11, marginTop: 3, lineHeight: 15 },

  // Popup card
  popupWrap: { position: "absolute", bottom: 34, left: 14, right: 14 },
  popupCard: {
    backgroundColor: SURFACE,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: HAIRLINE,
    padding: 16,
  },
  popupHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  popupCity:  { color: CHALK, fontSize: 18, fontWeight: "700" },
  popupLabel: { color: LIME,  fontSize: 13, fontWeight: "600", marginTop: 2 },
  popupSub:   { color: MUTED, fontSize: 13, marginTop: 2 },
  popupClose: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: SURFACE_LIFT,
    alignItems: "center", justifyContent: "center",
  },
  popupCloseText: { color: MUTED, fontSize: 14, fontWeight: "700" },

  popupRows: { gap: 8 },
  popupRow:  { flexDirection: "row", alignItems: "center", gap: 10 },
  popupRowIcon: { fontSize: 16, width: 22, textAlign: "center" },
  popupRowText: { color: CHALK, fontSize: 14, fontWeight: "500", flex: 1 },

  popupCta: {
    marginTop: 14,
    backgroundColor: LIME,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: "center",
  },
  popupCtaText: { color: BG, fontSize: 14, fontWeight: "700" },

  privacyNote: {
    color: MUTED,
    fontSize: 11,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: HAIRLINE,
  },

  // Activity overlay
  activityOverlay: {
    position: "absolute",
    bottom: 34,
    left: 14,
    right: 14,
    backgroundColor: "rgba(11,15,13,0.93)",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: HAIRLINE,
    padding: 20,
  },
  actKicker:   { color: LIME,  fontSize: 10, fontWeight: "800", letterSpacing: 2, marginBottom: 4 },
  actHeadline: { color: CHALK, fontSize: 22, fontWeight: "800", marginBottom: 16 },
  actCards:    { gap: 10 },
  actCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    padding: 12,
    gap: 12,
  },
  actDot:   { width: 10, height: 10, borderRadius: 5 },
  actLabel: { color: CHALK, fontSize: 14, fontWeight: "700" },
  actSub:   { color: MUTED, fontSize: 12, marginTop: 1 },
  actValue: { fontSize: 22, fontWeight: "800", minWidth: 40, textAlign: "right" },
  actNote:  { color: MUTED, fontSize: 11, marginTop: 14 },
});
