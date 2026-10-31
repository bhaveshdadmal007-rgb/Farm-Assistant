/* ==========================================================
   app.js
   Connects the dropdowns, the weather API and the page.
   Renders the dashboard, wind compass, forecast and insights.
   ========================================================== */

// Thresholds for the general farming suggestions.
// These are simple rules of thumb chosen for this site; adjust them here if needed.
const HIGH_WIND_KMH = 20;          // wind at or above this speed -> spraying caution
const RAIN_PROBABILITY_PCT = 50;   // daily rain probability at or above this -> irrigation review
const HIGH_TEMPERATURE_C = 35;     // temperature at or above this -> soil moisture check

// Weather is refreshed automatically for the selected location every 15 minutes
const REFRESH_INTERVAL_MS = 15 * 60 * 1000;

// Shown in place of any value the API did not provide
const NOT_AVAILABLE = "N/A";

// Page elements used often
const elements = {
  form: document.getElementById("location-form"),
  error: document.getElementById("location-error"),
  selectedText: document.getElementById("selected-location-text"),
  lastUpdated: document.getElementById("last-updated-text"),
  status: document.getElementById("status-message"),
  button: document.getElementById("view-weather-btn"),
  retryButton: document.getElementById("retry-weather-btn"),
  breadcrumb: document.getElementById("taluka-breadcrumb"),
  talukaName: document.getElementById("taluka-name"),
  coords: document.getElementById("taluka-coords"),
  conditionIcon: document.getElementById("condition-icon"),
  temp: document.getElementById("temp-value"),
  feels: document.getElementById("feels-value"),
  conditionText: document.getElementById("condition-text"),
  humidity: document.getElementById("humidity-value"),
  rain: document.getElementById("rain-value"),
  windSpeed: document.getElementById("wind-speed"),
  windDegrees: document.getElementById("wind-degrees"),
  windDirectionText: document.getElementById("wind-direction-text"),
  needle: document.getElementById("wind-needle"),
  forecastGrid: document.getElementById("forecast-grid"),
  insightsList: document.getElementById("insights-list")
};

// The request currently allowed to update the dashboard (null when idle)
let activeRequest = null;      // { id, controller }
let requestCounter = 0;

// Location whose weather is shown, or being loaded (null when none)
let currentLocation = null;
// Id of the location whose weather is currently on screen (null when none)
let displayedLocationId = null;

let refreshTimerId = null;

/* ---------- Small helpers ---------- */

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/** Rounds a number for display, or returns N/A when the value is missing. */
function roundOrNA(value) {
  return isNumber(value) ? String(Math.round(value)) : NOT_AVAILABLE;
}

/** Formats a number with one decimal place, or N/A. */
function oneDecimalOrNA(value) {
  return isNumber(value) ? value.toFixed(1) : NOT_AVAILABLE;
}

function showMessage(element, text) {
  element.textContent = text;
  element.hidden = !text;
}

/** Shows a loading or status line above the dashboard. */
function setStatus(text) {
  showMessage(elements.status, text);
}

/** Clears all weather values back to placeholders (used before a new location loads or on errors). */
function clearWeatherDisplay() {
  elements.temp.textContent = "--";
  elements.feels.textContent = "--";
  elements.conditionText.textContent = "--";
  elements.conditionIcon.textContent = "help";
  elements.humidity.textContent = "--";
  elements.rain.textContent = "--";
  elements.windSpeed.textContent = "--";
  elements.windDegrees.textContent = "--";
  elements.windDirectionText.textContent = "--";
  elements.needle.setAttribute("transform", "rotate(0 150 150)");
  elements.forecastGrid.innerHTML = "";
  elements.insightsList.innerHTML = "";
  displayedLocationId = null;
}

/** Formats a date string like "Mon 24 Oct" using the browser's locale. */
function formatForecastDate(isoDate) {
  const date = new Date(isoDate + "T00:00:00");
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/**
 * Turns the API time "2026-10-31T14:15" (the location's own local time) into
 * "31 Oct 2026, 14:15". The text is shown as given, without converting timezones.
 */
function formatObservationTime(isoLocal) {
  if (typeof isoLocal !== "string") return NOT_AVAILABLE;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(isoLocal);
  if (!match) return NOT_AVAILABLE;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) +
         ", " + match[4] + ":" + match[5];
}

/** Button shows "View Weather" and is enabled only when a valid location with coordinates is chosen. */
function setButtonIdle() {
  elements.button.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">radar</span> View Weather';
  elements.button.disabled = !getSelectedLocation().location;
}

/* ---------- Rendering ---------- */

/** Fills the Current Weather card and the wind compass. */
function renderCurrent(location, weather) {
  const c = weather.current;

  elements.breadcrumb.textContent = location.state + " · " + location.district + " District";
  elements.talukaName.textContent = location.name;
  elements.coords.textContent =
    (location.approximate ? "Approximate location: " : "Location: ") +
    location.latitude.toFixed(4) + "° N, " + location.longitude.toFixed(4) + "° E";

  const condition = describeWeatherCode(c.weatherCode);
  elements.conditionIcon.textContent = condition.icon;
  elements.conditionText.textContent = condition.label;

  elements.temp.textContent = roundOrNA(c.temperature);
  elements.feels.textContent = roundOrNA(c.feelsLike);
  elements.humidity.textContent = isNumber(c.humidity) ? Math.round(c.humidity) + "%" : NOT_AVAILABLE;
  elements.rain.textContent = isNumber(c.precipitation) ? c.precipitation.toFixed(1) + " mm" : NOT_AVAILABLE;

  // Wind
  elements.windSpeed.textContent = roundOrNA(c.windSpeed);
  if (isNumber(c.windDirection)) {
    const windDeg = Math.round(c.windDirection);
    const compass = degreesToCompass(c.windDirection);
    elements.windDegrees.textContent = windDeg + "°";
    elements.windDirectionText.textContent = compass + " (" + windDeg + "°)";
    // Rotate the compass needle to the actual wind direction (centre is 150,150 in the SVG)
    elements.needle.setAttribute("transform", "rotate(" + windDeg + " 150 150)");
  } else {
    elements.windDegrees.textContent = NOT_AVAILABLE;
    elements.windDirectionText.textContent = NOT_AVAILABLE;
    elements.needle.setAttribute("transform", "rotate(0 150 150)");
  }
}

/** Builds one card per forecast day from the daily data. */
function renderForecast(weather) {
  elements.forecastGrid.innerHTML = weather.daily.map(function (day, index) {
    const condition = describeWeatherCode(day.weatherCode);
    const note = index === 0 ? "Today" : index === 1 ? "Tomorrow" : "";
    const temp = isNumber(day.tempMin) && isNumber(day.tempMax)
      ? Math.round(day.tempMin) + "° - " + Math.round(day.tempMax) + "°C"
      : NOT_AVAILABLE;
    const rainChance = isNumber(day.precipProbability) ? Math.round(day.precipProbability) + "%" : NOT_AVAILABLE;
    const maxWind = isNumber(day.maxWindSpeed) ? Math.round(day.maxWindSpeed) + " km/h" : NOT_AVAILABLE;
    return `
      <article class="card forecast-day">
        <div>
          <span class="day-name">${formatForecastDate(day.date)}</span>
          <span class="day-note">${note}</span>
        </div>
        <div class="forecast-icon"><span class="material-symbols-outlined">${condition.icon}</span></div>
        <span class="condition-chip">${condition.label}</span>
        <div class="forecast-rows">
          <div class="forecast-row">
            <span class="label">Temp</span>
            <strong>${temp}</strong>
          </div>
          <div class="forecast-row">
            <span class="label">Rain chance</span>
            <strong>${rainChance}</strong>
          </div>
          <div class="forecast-row">
            <span class="label">Max wind</span>
            <strong>${maxWind}</strong>
          </div>
        </div>
      </article>`;
  }).join("");
}

/**
 * Creates general suggestions from the real current and forecast values.
 * Only conditions that are actually met produce a suggestion. Missing values never trigger one.
 */
function buildFarmingInsights(weather) {
  const insights = [];
  const c = weather.current;

  if (isNumber(c.windSpeed) && c.windSpeed >= HIGH_WIND_KMH) {
    insights.push({
      type: "is-caution",
      title: "High wind: avoid pesticide spraying",
      text: "Wind is " + Math.round(c.windSpeed) + " km/h, at or above " + HIGH_WIND_KMH +
            " km/h. Spraying in windy conditions can cause spray drift, so avoid spraying until the wind drops."
    });
  }

  const rainDay = weather.daily.find(function (day) {
    return isNumber(day.precipProbability) && day.precipProbability >= RAIN_PROBABILITY_PCT;
  });
  const rainingNow = isNumber(c.precipitation) && c.precipitation > 0;
  if (rainingNow || rainDay) {
    const when = rainingNow ? "Rain is falling now" :
      "Rain is likely on " + formatForecastDate(rainDay.date) + " (" + Math.round(rainDay.precipProbability) + "% chance)";
    insights.push({
      type: "is-info",
      title: "Rainfall expected: review irrigation",
      text: when + ". Consider reviewing your irrigation requirements."
    });
  }

  if (isNumber(c.temperature) && c.temperature >= HIGH_TEMPERATURE_C) {
    insights.push({
      type: "is-caution",
      title: "High temperature: monitor soil moisture",
      text: "Temperature is " + Math.round(c.temperature) + "°C, at or above " + HIGH_TEMPERATURE_C +
            "°C. Monitoring soil moisture is a sensible general step in hot conditions."
    });
  }

  const anyCurrentMissing = !isNumber(c.windSpeed) || !isNumber(c.precipitation) || !isNumber(c.temperature);
  if (insights.length === 0) {
    insights.push({
      type: "is-info",
      title: anyCurrentMissing ? "Not enough data for suggestions" : "No specific suggestion",
      text: anyCurrentMissing
        ? "Some wind, rain or temperature values are not available from the weather service, so these general suggestions cannot be checked."
        : "Current conditions do not meet the wind, rain or temperature levels used for these general suggestions."
    });
  }

  return insights;
}

function renderInsights(weather) {
  elements.insightsList.innerHTML = buildFarmingInsights(weather).map(function (item) {
    return `
      <article class="insight ${item.type}">
        <h3>${item.title}</h3>
        <p>${item.text}</p>
      </article>`;
  }).join("");
}

/* ---------- Data flow ---------- */

/** Marks the page as loading. silent=true means an automatic refresh that keeps the data on screen. */
function setLoadingState(location, silent) {
  elements.button.disabled = true;
  elements.button.textContent = "Loading...";
  elements.form.setAttribute("aria-busy", "true");
  elements.retryButton.hidden = true;
  showMessage(elements.error, "");
  setStatus(silent ? "Refreshing weather..." : "Fetching weather for " + location.name + "...");
}

/**
 * Fetches and displays weather for one validated location.
 * Only the newest request may update the page: an older response that arrives late is ignored,
 * and the previous request is aborted as soon as a new one starts.
 * silent=true is used by the 15-minute refresh; it never replaces valid data with an error.
 */
async function loadWeatherFor(location, silent) {
  // An automatic refresh does not overlap a request that is already running
  if (silent && activeRequest) return;

  if (activeRequest) activeRequest.controller.abort();

  const id = ++requestCounter;
  const controller = new AbortController();
  activeRequest = { id: id, controller: controller };
  const isCurrent = function () { return activeRequest !== null && activeRequest.id === id; };

  currentLocation = location;
  setLoadingState(location, silent);

  try {
    let resolvedLoc = location;
    if (typeof location.latitude !== "number" || typeof location.longitude !== "number") {
      setStatus("Finding coordinates for " + location.name + "...");
      resolvedLoc = await resolveLocationCoordinates(location, controller.signal);
      if (!isCurrent()) return;
      currentLocation = resolvedLoc;
      setStatus(silent ? "Refreshing weather..." : "Fetching weather for " + resolvedLoc.name + "...");
    }

    const weather = await fetchWeather(resolvedLoc.latitude, resolvedLoc.longitude, controller.signal);
    if (!isCurrent()) return;

    renderCurrent(resolvedLoc, weather);
    renderForecast(weather);
    renderInsights(weather);
    displayedLocationId = resolvedLoc.id;
    setStatus("");
    elements.lastUpdated.textContent =
      "Weather time: " + formatObservationTime(weather.time) +
      " · Fetched: " + new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  } catch (err) {
    if (err.name === "AbortError" || !isCurrent()) return;

    setStatus("");
    if (silent && displayedLocationId === location.id) {
      // Keep the last good data on screen and say that the refresh failed
      showMessage(elements.error, "The automatic refresh failed (" + err.message + "). The data shown is from the last successful update.");
      elements.lastUpdated.textContent = "Refresh failed at " +
        new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    } else {
      clearWeatherDisplay();
      showMessage(elements.error, err.message + " No weather data is shown.");
      elements.lastUpdated.textContent = "Update failed";
      elements.retryButton.hidden = false;
    }
  } finally {
    if (isCurrent()) {
      activeRequest = null;
      elements.form.removeAttribute("aria-busy");
      setButtonIdle();
    }
  }
}

/** Stops any running request and clears the dashboard. Called whenever the selection changes. */
function resetForNewSelection() {
  if (activeRequest) {
    activeRequest.controller.abort();
    activeRequest = null;
    elements.form.removeAttribute("aria-busy");
  }
  currentLocation = null;
  clearWeatherDisplay();
  setStatus("");
  showMessage(elements.error, "");
  elements.retryButton.hidden = true;
  elements.lastUpdated.textContent = "Not yet updated";
  setButtonIdle();
}

/** Validates the dropdown choice and, if valid, loads its weather. */
function handleLocationChoice() {
  const result = getSelectedLocation();

  if (result.error) {
    resetForNewSelection();
    showMessage(elements.error, result.error);
    elements.selectedText.textContent = result.unavailable
      ? "Weather is not available for this taluka / tehsil yet."
      : "No valid location selected.";
    return;
  }

  const location = result.location;
  showMessage(elements.error, "");
  elements.selectedText.innerHTML = 'Showing data for: <span class="selected-name"></span>';
  elements.selectedText.querySelector(".selected-name").textContent =
    location.name + " Taluka / Tehsil, " + location.district + " District, " + location.state;

  loadWeatherFor(location, false);
}

/* ---------- Event wiring ---------- */

function attachEvents() {
  // State change: reset the lower dropdowns and clear the old weather
  stateSelect.addEventListener("change", function () {
    populateDistricts(stateSelect.value);
    populateSubdivisions("");
    resetForNewSelection();
    elements.selectedText.textContent = "Select a district and taluka / tehsil to see weather.";
  });

  // District change: reset the taluka dropdown and clear the old weather
  districtSelect.addEventListener("change", function () {
    populateSubdivisions(districtSelect.value);
    resetForNewSelection();
    elements.selectedText.textContent = "Select a taluka / tehsil to see weather.";
  });

  // Taluka change: update the dashboard straight away
  talukaSelect.addEventListener("change", handleLocationChoice);

  // View Weather button (form submit)
  elements.form.addEventListener("submit", function (event) {
    event.preventDefault();
    handleLocationChoice();
  });

  // Retry keeps the same selected location
  elements.retryButton.addEventListener("click", function () {
    if (currentLocation) loadWeatherFor(currentLocation, false);
  });

  // Highlight the nav link for the section in view
  setupActiveNavLinks();
}

/** Marks the nav link whose section is currently on screen. */
function setupActiveNavLinks() {
  const links = document.querySelectorAll(".main-nav .nav-link");
  const sections = Array.from(links).map(function (link) {
    return document.querySelector(link.getAttribute("href"));
  });

  const observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      links.forEach(function (link) {
        link.classList.toggle("is-active", link.getAttribute("href") === "#" + entry.target.id);
      });
    });
  }, { rootMargin: "-40% 0px -55% 0px" });

  sections.forEach(function (section) {
    if (section) observer.observe(section);
  });
}

/* ---------- Start ---------- */

async function startApp() {
  attachEvents();
  elements.selectedText.textContent = "Loading location data...";

  try {
    await initLocationSelectors();
    elements.selectedText.textContent = "Select a state, district and taluka / tehsil to see weather.";
  } catch (err) {
    showLocationDataUnavailable();
    showMessage(elements.error, err.message);
    elements.selectedText.textContent = "Location data is not available.";
  }

  setButtonIdle();

  // Automatic refresh every 15 minutes for the selected location only
  refreshTimerId = setInterval(function () {
    if (currentLocation) loadWeatherFor(currentLocation, true);
  }, REFRESH_INTERVAL_MS);
}

document.addEventListener("DOMContentLoaded", startApp);
