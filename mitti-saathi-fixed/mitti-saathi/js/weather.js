/* ==========================================================
   weather.js
   Talks to the Open-Meteo forecast API and converts the raw
   response into the values the page needs.
   No API key is required.
   ========================================================== */

const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

const COMPASS_POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/**
 * Converts a wind direction in degrees (0-360, direction wind comes FROM)
 * into one of the 8 compass points. Each point covers 45 degrees.
 */
function degreesToCompass(degrees) {
  const normalised = ((degrees % 360) + 360) % 360;
  const index = Math.round(normalised / 45) % 8;
  return COMPASS_POINTS[index];
}

/**
 * Maps a WMO weather code (returned by Open-Meteo) to a label and a Material Symbols icon.
 * Full code list: https://open-meteo.com/en/docs (WMO Weather interpretation codes)
 */
function describeWeatherCode(code) {
  const map = {
    0: ["Clear sky", "clear_day"],
    1: ["Mainly clear", "clear_day"],
    2: ["Partly cloudy", "partly_cloudy_day"],
    3: ["Overcast", "cloud"],
    45: ["Fog", "foggy"],
    48: ["Depositing rime fog", "foggy"],
    51: ["Light drizzle", "rainy"],
    53: ["Moderate drizzle", "rainy"],
    55: ["Dense drizzle", "rainy"],
    56: ["Light freezing drizzle", "rainy"],
    57: ["Dense freezing drizzle", "rainy"],
    61: ["Slight rain", "rainy"],
    63: ["Moderate rain", "rainy"],
    65: ["Heavy rain", "rainy"],
    66: ["Light freezing rain", "rainy"],
    67: ["Heavy freezing rain", "rainy"],
    71: ["Slight snow", "weather_snowy"],
    73: ["Moderate snow", "weather_snowy"],
    75: ["Heavy snow", "weather_snowy"],
    77: ["Snow grains", "weather_snowy"],
    80: ["Slight rain showers", "rainy"],
    81: ["Moderate rain showers", "rainy"],
    82: ["Violent rain showers", "rainy"],
    85: ["Slight snow showers", "weather_snowy"],
    86: ["Heavy snow showers", "weather_snowy"],
    95: ["Thunderstorm", "thunderstorm"],
    96: ["Thunderstorm with hail", "thunderstorm"],
    99: ["Thunderstorm with heavy hail", "thunderstorm"]
  };
  const entry = map[code];
  return entry ? { label: entry[0], icon: entry[1] } : { label: "Unknown conditions", icon: "help" };
}

/** Returns the value if it is a finite number, otherwise null (never 0). */
function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Requests current conditions and a 7-day daily forecast for a point.
 * signal (optional) is an AbortSignal; aborting it cancels the request.
 * Throws an Error if the network fails or the API reports a problem.
 */
async function fetchWeather(latitude, longitude, signal) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "precipitation",
      "weather_code",
      "wind_speed_10m",
      "wind_direction_10m"
    ].join(","),
    daily: [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_probability_max",
      "wind_speed_10m_max"
    ].join(","),
    timezone: "auto",
    forecast_days: "7",
    wind_speed_unit: "kmh"
  });

  let response;
  try {
    response = await fetch(OPEN_METEO_FORECAST_URL + "?" + params.toString(), { signal: signal });
  } catch (fetchError) {
    if (fetchError.name === "AbortError") throw fetchError; // cancelled on purpose, not a failure
    throw new Error("Network error: could not reach Open-Meteo. Check your internet connection.");
  }

  if (!response.ok) {
    throw new Error("Open-Meteo returned an error (HTTP " + response.status + ").");
  }

  let data;
  try {
    data = await response.json();
  } catch (parseError) {
    throw new Error("Open-Meteo sent a response that could not be read.");
  }

  if (data.error) {
    throw new Error("Open-Meteo reported an error: " + (data.reason || "unknown reason"));
  }

  return normaliseWeather(data);
}

/**
 * Picks out only the fields the website uses.
 * Missing or invalid values become null, so the display can show "N/A" instead of 0.
 */
function normaliseWeather(data) {
  if (!data.current || !data.daily || !Array.isArray(data.daily.time)) {
    throw new Error("Weather data is incomplete. Please try again.");
  }

  const c = data.current;
  const d = data.daily;
  const at = function (list, i) { return Array.isArray(list) ? numberOrNull(list[i]) : null; };

  return {
    // Timestamp of the current observation, in the location's own timezone, e.g. "2026-10-31T14:15"
    time: typeof c.time === "string" ? c.time : null,
    current: {
      temperature: numberOrNull(c.temperature_2m),
      feelsLike: numberOrNull(c.apparent_temperature),
      humidity: numberOrNull(c.relative_humidity_2m),
      precipitation: numberOrNull(c.precipitation),   // mm in the current hour
      weatherCode: numberOrNull(c.weather_code),
      windSpeed: numberOrNull(c.wind_speed_10m),      // km/h (requested with wind_speed_unit=kmh)
      windDirection: numberOrNull(c.wind_direction_10m) // degrees the wind blows FROM
    },
    daily: d.time.map(function (date, i) {
      return {
        date: date,                                   // "YYYY-MM-DD" in the location's timezone
        weatherCode: at(d.weather_code, i),
        tempMin: at(d.temperature_2m_min, i),
        tempMax: at(d.temperature_2m_max, i),
        precipProbability: at(d.precipitation_probability_max, i),
        maxWindSpeed: at(d.wind_speed_10m_max, i)
      };
    })
  };
}
