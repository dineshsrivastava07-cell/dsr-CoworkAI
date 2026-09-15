export interface RpaCredential {
  name: string;
  username: string;
  password: string;
}

let activeCredentialSecrets: string[] = [];

function loadCredentialProfiles(): RpaCredential[] {
  try {
    const parsed = JSON.parse(process.env.RPA_CREDENTIAL_PROFILES_JSON || '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (candidate): candidate is RpaCredential =>
        Boolean(candidate) &&
        typeof candidate === 'object' &&
        typeof (candidate as RpaCredential).name === 'string' &&
        typeof (candidate as RpaCredential).username === 'string' &&
        typeof (candidate as RpaCredential).password === 'string'
    );
  } catch {
    return [];
  } finally {
    // Do not let screenshots/input helper subprocesses inherit the serialized profiles.
    delete process.env.RPA_CREDENTIAL_PROFILES_JSON;
  }
}

let runtimeCredentialProfiles = loadCredentialProfiles();

/** Test-only hook; production profiles are loaded once during connector bootstrap. */
export function _setRuntimeCredentialsForTesting(profiles: RpaCredential[]): void {
  runtimeCredentialProfiles = profiles;
  activeCredentialSecrets = [];
}

export function resolveCredentialProfile(name: string): RpaCredential {
  const normalizedName = name.trim().toLowerCase();
  const profile = runtimeCredentialProfiles.find(
    (candidate) => candidate.name.trim().toLowerCase() === normalizedName
  );
  if (!profile || !profile.username || !profile.password) {
    throw new Error(
      `RPA credential profile "${name}" is unavailable. Save it in RPA settings first.`
    );
  }
  activeCredentialSecrets = [profile.username, profile.password].filter(Boolean);
  return profile;
}

export function fillCredentialParams(
  args: Record<string, unknown>,
  profileName?: string
): Record<string, unknown> {
  if (!profileName) return args;
  const profile = resolveCredentialProfile(profileName);
  const fill = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return value
        .replace(/\{\{credential\.username\}\}/g, profile.username)
        .replace(/\{\{credential\.password\}\}/g, profile.password);
    }
    if (Array.isArray(value)) return value.map(fill);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fill(item)]));
    }
    return value;
  };
  return fill(args) as Record<string, unknown>;
}

export function redactCredentialSecrets(value: unknown): unknown {
  if (typeof value === 'string') {
    return activeCredentialSecrets.reduce(
      (text, secret) => (secret ? text.split(secret).join('[REDACTED]') : text),
      value
    );
  }
  if (Array.isArray(value)) return value.map(redactCredentialSecrets);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactCredentialSecrets(item)])
    );
  }
  return value;
}
