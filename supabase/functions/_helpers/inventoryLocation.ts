// Shared by ebay-publish and bulk-publish.
//
// eBay's updateInventoryLocationDetails has no address container (postalCode and
// city cannot be changed on an existing location), so an address is only ever set
// by creating a location. deleteInventoryLocation is refused while an active item
// or published offer references the location, and eBay does not document what a
// delete does to live listings. So an existing location is never deleted: it is
// read (getInventoryLocation), reused when its address matches, and replaced for
// new listings by an address-keyed location when it does not.

type FetchFn = (url: string, options: RequestInit & { timeout?: number }) => Promise<Response>;

export interface LocationAddress {
  postalCode: string;
  city?: string;
  country?: string;
}

interface StoredLocation {
  location?: { address?: { postalCode?: unknown; city?: unknown } };
}

// merchantLocationKey must be at most 36 characters (createInventoryLocation).
// eBay documents no character rules, so keep to letters, digits and hyphens.
export async function addressLocationKey(postalCode: string, city = ""): Promise<string> {
  const zip = postalCode.replace(/[^a-zA-Z0-9]/g, "");
  const normalizedAddress = `${normalizeAddressPart(postalCode)}\0${normalizeAddressPart(city)}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalizedAddress));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `loc-${zip.slice(0, 5)}-${hash.slice(0, 26)}`;
}

function normalizeAddressPart(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

// True when a location returned by getInventoryLocation already has the wanted
// address. An empty wanted city matches any stored city, because the create call
// omits the city when none is known.
export function locationAddressMatches(
  location: StoredLocation | null | undefined,
  postalCode: string,
  city = "",
): boolean {
  const stored = location?.location?.address;
  if (!stored) return false;
  if (normalizeAddressPart(stored.postalCode) !== normalizeAddressPart(postalCode)) return false;
  const wantedCity = normalizeAddressPart(city);
  return wantedCity === "" || normalizeAddressPart(stored.city) === wantedCity;
}

type LocationLookup =
  | { status: "found"; location: StoredLocation }
  | { status: "missing" }
  | { status: "unreadable"; reason: string };

async function getLocation(
  fetchFn: FetchFn,
  apiBase: string,
  headers: Record<string, string>,
  key: string,
): Promise<LocationLookup> {
  try {
    const r = await fetchFn(`${apiBase}/sell/inventory/v1/location/${key}`, {
      method: "GET",
      headers,
      timeout: 15000,
    });
    if (r.status === 404) return { status: "missing" };
    if (!r.ok) return { status: "unreadable", reason: `HTTP ${r.status}` };
    return { status: "found", location: await r.json() };
  } catch (err) {
    return { status: "unreadable", reason: err instanceof Error ? err.message : String(err) };
  }
}

function isAlreadyExists(status: number, body: string): boolean {
  if (status === 409) return true;
  try {
    const parsed = JSON.parse(body);
    return Array.isArray(parsed.errors) && parsed.errors.some((e: { errorId: number }) => e.errorId === 25803);
  } catch {
    return false;
  }
}

export interface ReconcileOptions {
  fetchFn: FetchFn;
  apiBase: string;
  userToken: string;
  /** The location key the caller wants to use when its address is correct. */
  baseKey: string;
  address: LocationAddress;
  /** Fields that differ between callers (name, location types). */
  locationBody: Record<string, unknown>;
  /** Prefix for log lines. */
  label: string;
}

export type ReconcileResult =
  | { ok: true; key: string }
  | { ok: false; key: string; status: number; body: string };

// Returns the key to use for new listings. Never deletes. On an unexpected error
// creating the base location it returns ok:false so each caller can keep its own
// policy (ebay-publish throws; bulk-publish logs and carries on).
export async function reconcileInventoryLocation(opts: ReconcileOptions): Promise<ReconcileResult> {
  const { fetchFn, apiBase, userToken, baseKey, address, locationBody, label } = opts;
  const postalCode = address.postalCode;
  const city = address.city ?? "";
  const baseUrl = `${apiBase}/sell/inventory/v1/location`;
  const writeHeaders = {
    Authorization: `Bearer ${userToken}`,
    "Content-Type": "application/json",
    "Content-Language": "en-US",
    // Deno injects the system locale when this is omitted, which eBay rejects
    // with errorId 25709.
    "Accept-Language": "en-US",
  };
  const readHeaders = { Authorization: `Bearer ${userToken}`, "Accept-Language": "en-US" };

  const create = (key: string) =>
    fetchFn(`${baseUrl}/${key}`, {
      method: "POST",
      headers: writeHeaders,
      body: JSON.stringify(locationBody),
      timeout: 15000,
    });

  const resp = await create(baseKey);
  if (resp.ok) {
    console.log(`${label}: location "${baseKey}" created successfully (status ${resp.status})`);
    return { ok: true, key: baseKey };
  }

  const errText = await resp.text();
  if (!isAlreadyExists(resp.status, errText)) {
    return { ok: false, key: baseKey, status: resp.status, body: errText };
  }

  const existing = await getLocation(fetchFn, apiBase, readHeaders, baseKey);

  if (existing.status === "found" && locationAddressMatches(existing.location, postalCode, city)) {
    console.log(`${label}: location "${baseKey}" already has postal code ${postalCode}; reusing it, nothing deleted`);
    return { ok: true, key: baseKey };
  }

  if (existing.status !== "found") {
    // Could not read the address (or it vanished between calls). Keep using the
    // base location rather than change anything that cannot be verified.
    const reason = existing.status === "unreadable" ? existing.reason : "not found";
    console.warn(`${label}: could not read "${baseKey}" (${reason}); using it as is`);
    return { ok: true, key: baseKey };
  }

  const addressKey = await addressLocationKey(postalCode, city);
  console.log(
    `${label}: "${baseKey}" has a different address; using address-keyed location "${addressKey}" (nothing deleted)`,
  );
  const keyed = await create(addressKey);
  if (keyed.ok) {
    console.log(`${label}: address-keyed location "${addressKey}" created`);
    return { ok: true, key: addressKey };
  }
  const keyedErr = await keyed.text();
  if (isAlreadyExists(keyed.status, keyedErr)) {
    const keyedExisting = await getLocation(fetchFn, apiBase, readHeaders, addressKey);
    if (
      keyedExisting.status === "found" &&
      locationAddressMatches(keyedExisting.location, postalCode, city)
    ) {
      console.log(`${label}: address-keyed location "${addressKey}" already exists and matches; reusing it`);
      return { ok: true, key: addressKey };
    }
    const reason = keyedExisting.status === "found"
      ? "stored address does not match"
      : keyedExisting.status === "unreadable"
      ? keyedExisting.reason
      : "not found";
    console.warn(`${label}: cannot verify address-keyed location "${addressKey}" (${reason}); using "${baseKey}"`);
    return { ok: true, key: baseKey };
  }
  console.error(
    `${label}: could not create "${addressKey}" (${keyed.status}): ${keyedErr}. Using "${baseKey}" with its existing address.`,
  );
  return { ok: true, key: baseKey };
}
