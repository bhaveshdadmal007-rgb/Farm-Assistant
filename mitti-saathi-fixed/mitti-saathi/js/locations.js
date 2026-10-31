/* ==========================================================
   locations.js
   Loads data/locations.json once and manages the three
   dependent dropdowns: State -> District -> Taluka / Tehsil.

   Dropdown values are the unique IDs from the JSON file, so two
   places with the same name (for example two "Aurangabad"s in
   different states) can never be mixed up.
   ========================================================== */

const LOCATION_DATA_URL = "data/locations.json";

// Shown when the JSON cannot be loaded. Browsers block fetch() for files
// opened with file://, which is the most common reason the dropdowns are empty.
const LOCATION_DATA_HELP =
  "Open this website through a local server, not by double-clicking index.html " +
  "(see README.md for the steps).";

// Parsed JSON, set once at start-up. Never written to by the rest of the code.
let locationData = null;

// Lookup tables built from the JSON so every dropdown change is a direct lookup.
const stateById = new Map();       // "ST-27" -> state object
const districtById = new Map();    // "DT-263" -> { district, state }
const subdivisionById = new Map(); // "SD-4155" -> { subdivision, district, state }

const stateSelect = document.getElementById("state-select");
const districtSelect = document.getElementById("district-select");
const talukaSelect = document.getElementById("taluka-select");

/**
 * Downloads and checks the location JSON.
 * Throws an Error with a message the user can act on if it cannot be used.
 */
async function loadLocationData() {
  let response;
  try {
    response = await fetch(LOCATION_DATA_URL);
  } catch (networkError) {
    throw new Error("Location data could not be loaded. " + LOCATION_DATA_HELP);
  }

  if (!response.ok) {
    throw new Error(
      "The location data file was not found (HTTP " + response.status + "). " +
      "Check that data/locations.json is inside the project folder."
    );
  }

  let data;
  try {
    data = await response.json();
  } catch (parseError) {
    throw new Error("The location data file is not valid JSON. Check data/locations.json for syntax errors.");
  }

  if (!data || !Array.isArray(data.states)) {
    throw new Error("The location data file has an unexpected structure (no 'states' list).");
  }
  return data;
}

/** Builds the lookup tables used by the dropdowns and the validation. */
function indexLocationData(data) {
  stateById.clear();
  districtById.clear();
  subdivisionById.clear();

  data.states.forEach(function (state) {
    stateById.set(state.id, state);
    (state.districts || []).forEach(function (district) {
      districtById.set(district.id, { district: district, state: state });
      (district.subdivisions || []).forEach(function (subdivision) {
        subdivisionById.set(subdivision.id, { subdivision: subdivision, district: district, state: state });
      });
    });
  });
}

/**
 * Replaces the options of one <select>.
 * options is a list of { value, label }. The first option is a placeholder with an empty value.
 */
function fillSelect(selectEl, options, placeholder, selectedValue) {
  selectEl.innerHTML = "";
  selectEl.add(new Option(placeholder, ""));
  options.forEach(function (option) {
    selectEl.add(new Option(option.label, option.value));
  });
  const keep = options.some(function (option) { return option.value === selectedValue; });
  selectEl.value = keep ? selectedValue : "";
}

/** Fills the State dropdown with all 28 States and 8 Union Territories. */
function populateStates() {
  const options = locationData.states.map(function (state) {
    return { value: state.id, label: state.name + (state.type === "Union Territory" ? " (UT)" : "") };
  });
  fillSelect(stateSelect, options, options.length ? "Select state" : "No states available", "");
  stateSelect.disabled = options.length === 0;
}

/** Fills the District dropdown for one State. Disabled until a State is chosen. */
function populateDistricts(stateId) {
  const state = stateById.get(stateId);
  const options = state ? state.districts.map(function (district) {
    return { value: district.id, label: district.name };
  }) : [];

  let placeholder = "Select district";
  if (!stateId) placeholder = "Select a state first";
  else if (state && options.length === 0) placeholder = "No districts in data";

  fillSelect(districtSelect, options, placeholder, "");
  districtSelect.disabled = options.length === 0;
}

/** Fills the Taluka / Tehsil dropdown for one District. Disabled until a District is chosen. */
function populateSubdivisions(districtId) {
  const entry = districtById.get(districtId);
  const district = entry ? entry.district : null;
  const options = district ? district.subdivisions.map(function (subdivision) {
    return { value: subdivision.id, label: subdivision.name };
  }) : [];

  let placeholder = "Select taluka / tehsil";
  if (!districtId) placeholder = "Select a district first";
  else if (district && district.subdivision_status === "not_in_source") placeholder = "No sub-districts in source data";
  else if (district && options.length === 0) placeholder = "No sub-districts in data";

  fillSelect(talukaSelect, options, placeholder, "");
  talukaSelect.disabled = options.length === 0;
}

/**
 * Checks the three dropdowns and returns the chosen location.
 * Returns { location } when weather can be fetched, or { error } with a message.
 * A sub-division with no coordinates returns { error, unavailable: true }.
 */
function getSelectedLocation() {
  if (!locationData) return { error: "Location data is not loaded yet." };

  const stateId = stateSelect.value;
  const districtId = districtSelect.value;
  const subdivisionId = talukaSelect.value;

  if (!stateId) return { error: "Please select a state." };
  if (!districtId) return { error: "Please select a district." };
  if (!subdivisionId) return { error: "Please select a taluka / tehsil." };

  // Guard against a selection that does not belong to the chosen State and District
  const entry = subdivisionById.get(subdivisionId);
  if (!entry || entry.district.id !== districtId || entry.state.id !== stateId) {
    return { error: "The selected location is not valid. Please choose it again." };
  }

  const subdivision = entry.subdivision;
  const hasCoordinates = typeof subdivision.latitude === "number" && typeof subdivision.longitude === "number";

  return {
    location: {
      id: subdivision.id,
      state: entry.state.name,
      district: entry.district.name,
      name: subdivision.name,
      latitude: hasCoordinates ? subdivision.latitude : null,
      longitude: hasCoordinates ? subdivision.longitude : null,
      approximate: hasCoordinates ? subdivision.coordinate_type !== "exact" : true,
      needsGeocode: !hasCoordinates
    }
  };
}

// In-memory cache for resolved coordinates so repeated selections don't re-query
const geocodeCache = new Map();

/**
 * Resolves latitude and longitude for a subdivision that lacks pre-configured coordinates.
 * Uses 100% free services (Open-Meteo Geocoding API and OpenStreetMap Nominatim) with local caching.
 * No API key or paid service required.
 */
async function resolveLocationCoordinates(location, signal) {
  if (typeof location.latitude === "number" && typeof location.longitude === "number") {
    return location;
  }

  const cacheKey = (location.id ? location.id + "_" : "") + location.state + "_" + location.district + "_" + location.name;
  
  // 1. Check in-memory cache
  if (geocodeCache.has(cacheKey)) {
    const cached = geocodeCache.get(cacheKey);
    return Object.assign({}, location, cached, { needsGeocode: false });
  }

  // 2. Check localStorage cache
  try {
    const stored = localStorage.getItem("coords_" + cacheKey);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (typeof parsed.latitude === "number" && typeof parsed.longitude === "number") {
        geocodeCache.set(cacheKey, parsed);
        return Object.assign({}, location, parsed, { needsGeocode: false });
      }
    }
  } catch (e) {
    // localStorage not accessible
  }

  const stateLower = (location.state || "").toLowerCase();
  const distLower = (location.district || "").toLowerCase();

  // Helper to test if a candidate matches the selected state or district
  function matchesRegion(itemAdmin1, itemAdmin2) {
    const a1 = (itemAdmin1 || "").toLowerCase();
    const a2 = (itemAdmin2 || "").toLowerCase();
    return (a1 && (a1.includes(stateLower) || stateLower.includes(a1))) ||
           (a2 && (a2.includes(distLower) || distLower.includes(a2)));
  }

  // 3. Strategy A: Open-Meteo Geocoding API (Fast, Free, Open-Meteo native, no API key needed)
  try {
    const omUrl = "https://geocoding-api.open-meteo.com/v1/search?name=" +
      encodeURIComponent(location.name) + "&count=10&language=en&format=json";
    const res = await fetch(omUrl, { signal: signal });
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.results) && data.results.length > 0) {
        const match = data.results.find(function (item) {
          return item.country_code === "IN" && matchesRegion(item.admin1, item.admin2);
        });

        if (match && typeof match.latitude === "number" && typeof match.longitude === "number") {
          const resolved = {
            latitude: match.latitude,
            longitude: match.longitude,
            approximate: true
          };
          saveGeocode(cacheKey, resolved);
          return Object.assign({}, location, resolved, { needsGeocode: false });
        }
      }
    }
  } catch (e) {
    if (e.name === "AbortError") throw e;
  }

  // 4. Strategy B: Photon OpenStreetMap Geocoding (CORS-friendly, free, OpenStreetMap data)
  try {
    const q = location.name + " " + location.district + " " + location.state;
    const photonUrl = "https://photon.komoot.io/api/?q=" + encodeURIComponent(q) + "&limit=5";
    const res = await fetch(photonUrl, { signal: signal });
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.features) && data.features.length > 0) {
        const match = data.features.find(function (f) {
          const p = f.properties || {};
          const country = (p.countrycode || "IN").toUpperCase();
          const s = (p.state || "").toLowerCase();
          return country === "IN" && (s.includes(stateLower) || stateLower.includes(s));
        }) || data.features[0];

        if (match && match.geometry && Array.isArray(match.geometry.coordinates)) {
          const lon = match.geometry.coordinates[0];
          const lat = match.geometry.coordinates[1];
          if (Number.isFinite(lat) && Number.isFinite(lon)) {
            const resolved = { latitude: lat, longitude: lon, approximate: true };
            saveGeocode(cacheKey, resolved);
            return Object.assign({}, location, resolved, { needsGeocode: false });
          }
        }
      }
    }
  } catch (e) {
    if (e.name === "AbortError") throw e;
  }

  // 5. Strategy C: District-level fallback via Open-Meteo search
  try {
    const distUrl = "https://geocoding-api.open-meteo.com/v1/search?name=" +
      encodeURIComponent(location.district) + "&count=10&language=en&format=json";
    const res = await fetch(distUrl, { signal: signal });
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.results) && data.results.length > 0) {
        const match = data.results.find(function (item) {
          const a1 = (item.admin1 || "").toLowerCase();
          return item.country_code === "IN" && (a1.includes(stateLower) || stateLower.includes(a1));
        }) || data.results.find(function (item) { return item.country_code === "IN"; });

        if (match && typeof match.latitude === "number" && typeof match.longitude === "number") {
          const resolved = {
            latitude: match.latitude,
            longitude: match.longitude,
            approximate: true
          };
          saveGeocode(cacheKey, resolved);
          return Object.assign({}, location, resolved, { needsGeocode: false });
        }
      }
    }
  } catch (e) {
    if (e.name === "AbortError") throw e;
  }

  throw new Error("Could not determine coordinates for " + location.name + ". Please check your connection and try again.");
}

function saveGeocode(key, data) {
  geocodeCache.set(key, data);
  try {
    localStorage.setItem("coords_" + key, JSON.stringify(data));
  } catch (e) {}
}

/**
 * Loads the data and sets up the dropdowns.
 * No location is pre-selected: the page must not show a place as the user's own location.
 * Throws if the data cannot be loaded; app.js shows the message.
 */
async function initLocationSelectors() {
  fillSelect(stateSelect, [], "Loading states...", "");
  stateSelect.disabled = true;

  locationData = await loadLocationData();
  indexLocationData(locationData);

  populateStates();
  populateDistricts("");
  populateSubdivisions("");
}

/** Shows a clear "data not available" state in all three dropdowns. */
function showLocationDataUnavailable() {
  fillSelect(stateSelect, [], "Location data unavailable", "");
  stateSelect.disabled = true;
  populateDistricts("");
  populateSubdivisions("");
}
