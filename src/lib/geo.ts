export interface GeoInput {
  latitude?: string;
  longitude?: string;
  accuracyMeters?: number;
}

export interface NormalizedGeoInput {
  latitude: string | null;
  longitude: string | null;
  accuracyMeters: number | undefined;
}

export interface GeoValidationResult {
  value?: NormalizedGeoInput;
  error?: string;
}

function parseCoordinate(
  input: string | undefined,
  min: number,
  max: number,
  label: string
): { value: string | null; error?: string } {
  const trimmed = input?.trim();
  if (!trimmed) return { value: null };

  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return { value: null, error: `Invalid ${label} format.` };
  }

  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) {
    return { value: null, error: `${label} is outside the valid range (${min} to ${max}).` };
  }

  return { value: numeric.toFixed(6) };
}

/** Validates browser-supplied coordinates before they are stored or displayed. */
export function validateGeoInput(input: GeoInput): GeoValidationResult {
  const latitude = parseCoordinate(input.latitude, -90, 90, 'Latitude');
  if (latitude.error) return { error: latitude.error };

  const longitude = parseCoordinate(input.longitude, -180, 180, 'Longitude');
  if (longitude.error) return { error: longitude.error };

  let accuracyMeters: number | undefined;
  if (input.accuracyMeters !== undefined) {
    if (
      !Number.isFinite(input.accuracyMeters) ||
      input.accuracyMeters < 0 ||
      input.accuracyMeters > 100000
    ) {
      return { error: 'Location accuracy must be between 0 and 100000 meters.' };
    }
    accuracyMeters = Math.round(input.accuracyMeters);
  }

  return {
    value: {
      latitude: latitude.value,
      longitude: longitude.value,
      accuracyMeters,
    },
  };
}

/** Maps browser GeolocationPositionError codes to user-facing messages. */
export function describeGeolocationError(error: unknown): string {
  const code = (error as { code?: number } | null)?.code;
  if (code === 1) {
    return 'Location permission denied. Allow location access in your browser settings, then try again.';
  }
  if (code === 2) {
    return 'Your location is unavailable. Check that device location services are enabled, then try again.';
  }
  if (code === 3) {
    return 'Location request timed out. Try again, or move to an area with a clearer GPS signal.';
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Unable to retrieve your location.';
}

/** Promise wrapper around navigator.geolocation.getCurrentPosition. */
export function readCurrentPosition(options: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocation is not supported by this browser.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}
