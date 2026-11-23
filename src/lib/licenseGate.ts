const LICENSE_STORAGE_KEY = 'openfs_active_license_v1';

const VALID_PREFIX = 'OPENFS-';
const KEY_PATTERN = /^OPENFS-[A-Z0-9]{3,6}-[A-Z0-9]{4,8}$/;

export function getCheckoutUrl(): string {
  const url = import.meta.env.VITE_CHECKOUT_URL;
  return typeof url === 'string' ? url.trim() : '';
}

export function getSavedLicenseKey(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const saved = window.localStorage.getItem(LICENSE_STORAGE_KEY);
    if (saved && KEY_PATTERN.test(saved)) {
      return saved;
    }
    return null;
  } catch {
    return null;
  }
}

export function isLicenseActive(): boolean {
  return getSavedLicenseKey() !== null;
}

export function validateLicenseFormat(rawKey: string): string | null {
  const normalized = rawKey.trim().toUpperCase().replace(/\s+/g, '');
  if (!normalized.startsWith(VALID_PREFIX)) return null;
  if (!KEY_PATTERN.test(normalized)) return null;
  return normalized;
}

export function activateLicenseKey(rawKey: string): { ok: boolean; key?: string; error?: string } {
  const normalized = validateLicenseFormat(rawKey);
  if (!normalized) {
    return {
      ok: false,
      error: 'Clé invalide. Format attendu : OPENFS-XXXX-XXXX (reçue par e-mail après achat).',
    };
  }

  try {
    window.localStorage.setItem(LICENSE_STORAGE_KEY, normalized);
  } catch {
    // Fallback if storage is restricted
  }

  return { ok: true, key: normalized };
}

export function revokeSavedLicense(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LICENSE_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

export function checkLicenseFromUrlParams(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const licenseParam = params.get('license');
  if (!licenseParam) return null;

  const result = activateLicenseKey(licenseParam);
  if (result.ok && result.key) {
    params.delete('license');
    const cleanQuery = params.toString();
    const nextUrl = `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ''}${window.location.hash}`;
    window.history.replaceState(null, '', nextUrl);
    return result.key;
  }
  return null;
}
