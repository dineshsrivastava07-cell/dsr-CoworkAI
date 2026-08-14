/**
 * Weather Tools MCP Server for V-Coworker
 *
 * Structured current-conditions and forecast data via Open-Meteo
 * (https://open-meteo.com) — free, no API key required.
 */

// Bootstrap logging - log as early as possible
import { writeMCPLog } from './mcp-logger.js';
import { type CallToolResult, type ListToolsResult, Server } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

writeMCPLog('=== Module Loading Started ===', 'Bootstrap');

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

// WMO weather interpretation codes used by Open-Meteo.
const WEATHER_CODE_DESCRIPTIONS: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  56: 'Light freezing drizzle',
  57: 'Dense freezing drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Heavy freezing rain',
  71: 'Slight snow fall',
  73: 'Moderate snow fall',
  75: 'Heavy snow fall',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
};

function describeWeatherCode(code: number): string {
  return WEATHER_CODE_DESCRIPTIONS[code] ?? `Unknown (code ${code})`;
}

interface GeocodeResult {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
}

async function geocodeLocation(location: string): Promise<GeocodeResult> {
  const url = new URL(GEOCODING_URL);
  url.searchParams.set('name', location);
  url.searchParams.set('count', '1');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Geocoding request failed: ${response.status} ${response.statusText}`);
  }
  const payload = (await response.json()) as { results?: GeocodeResult[] };
  const first = payload.results?.[0];
  if (!first) {
    throw new Error(`Could not find a location matching "${location}"`);
  }
  return first;
}

async function fetchForecast(
  latitude: number,
  longitude: number,
  forecastDays: number
): Promise<string> {
  const url = new URL(FORECAST_URL);
  url.searchParams.set('latitude', String(latitude));
  url.searchParams.set('longitude', String(longitude));
  url.searchParams.set(
    'current',
    'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m'
  );
  url.searchParams.set(
    'daily',
    'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max'
  );
  url.searchParams.set('forecast_days', String(Math.min(Math.max(forecastDays, 1), 16)));
  url.searchParams.set('timezone', 'auto');

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Forecast request failed: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as {
    timezone: string;
    current: {
      temperature_2m: number;
      relative_humidity_2m: number;
      apparent_temperature: number;
      precipitation: number;
      weather_code: number;
      wind_speed_10m: number;
    };
    daily: {
      time: string[];
      weather_code: number[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      precipitation_sum: number[];
      wind_speed_10m_max: number[];
    };
  };

  const lines: string[] = [];
  lines.push(`Timezone: ${data.timezone}`);
  lines.push('');
  lines.push('Current conditions:');
  lines.push(`  ${describeWeatherCode(data.current.weather_code)}`);
  lines.push(
    `  Temperature: ${data.current.temperature_2m}°C (feels like ${data.current.apparent_temperature}°C)`
  );
  lines.push(`  Humidity: ${data.current.relative_humidity_2m}%`);
  lines.push(`  Precipitation: ${data.current.precipitation} mm`);
  lines.push(`  Wind: ${data.current.wind_speed_10m} km/h`);
  lines.push('');
  lines.push('Forecast:');
  for (let i = 0; i < data.daily.time.length; i++) {
    lines.push(
      `  ${data.daily.time[i]}: ${describeWeatherCode(data.daily.weather_code[i])}, ` +
        `${data.daily.temperature_2m_min[i]}–${data.daily.temperature_2m_max[i]}°C, ` +
        `precip ${data.daily.precipitation_sum[i]} mm, wind up to ${data.daily.wind_speed_10m_max[i]} km/h`
    );
  }
  return lines.join('\n');
}

function createMcpServer() {
  const server = new Server(
    { name: 'weather-tools-server', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(
    'tools/list',
    async (): Promise<ListToolsResult> => ({
      tools: [
        {
          name: 'get_weather',
          description:
            'Get current weather conditions and a multi-day forecast for a location. Provide either a place name ' +
            '(city, region, or "City, Country") which will be geocoded automatically, or explicit latitude/longitude. ' +
            'Useful for trip planning, logistics/supply-chain scheduling, event planning, or any task that depends on weather.',
          inputSchema: {
            type: 'object',
            properties: {
              location: {
                type: 'string',
                description:
                  'Place name to look up, e.g. "Mumbai", "Bengaluru, India", "New York".',
              },
              latitude: {
                type: 'number',
                description:
                  'Latitude, if calling with explicit coordinates instead of a place name.',
              },
              longitude: {
                type: 'number',
                description:
                  'Longitude, if calling with explicit coordinates instead of a place name.',
              },
              forecast_days: {
                type: 'number',
                description: 'Number of forecast days to return (1-16). Default: 3.',
              },
            },
          },
        },
      ],
    })
  );

  server.setRequestHandler('tools/call', async (request): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params;

    try {
      writeMCPLog(`[CallTool] name=${name}, args=${JSON.stringify(args ?? {})}`, 'Tool Call');

      if (name !== 'get_weather') {
        throw new Error(`Unknown tool: ${name}`);
      }

      const {
        location,
        latitude,
        longitude,
        forecast_days = 3,
      } = args as {
        location?: string;
        latitude?: number;
        longitude?: number;
        forecast_days?: number;
      };

      let lat = latitude;
      let lon = longitude;
      let resolvedName = location ?? '';

      if ((lat === undefined || lon === undefined) && location) {
        const geocoded = await geocodeLocation(location);
        lat = geocoded.latitude;
        lon = geocoded.longitude;
        resolvedName = [geocoded.name, geocoded.admin1, geocoded.country]
          .filter(Boolean)
          .join(', ');
      }

      if (lat === undefined || lon === undefined) {
        throw new Error('Provide either "location" or both "latitude" and "longitude".');
      }

      const forecastText = await fetchForecast(lat, lon, forecast_days);
      const header = resolvedName
        ? `Weather for ${resolvedName} (${lat}, ${lon})`
        : `Weather for (${lat}, ${lon})`;

      return {
        content: [{ type: 'text', text: `${header}\n\n${forecastText}` }],
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      writeMCPLog(`[CallTool] Error in ${name}: ${msg}`, 'Tool Call Error');
      return {
        content: [{ type: 'text', text: `❌ Error in ${name}: ${msg}` }],
        isError: true,
      };
    }
  });

  return server;
}

serveStdio(() => createMcpServer(), {
  onerror: (error: Error) => {
    process.stderr.write(`[weather-tools-server] Fatal: ${error}\n`);
  },
});
