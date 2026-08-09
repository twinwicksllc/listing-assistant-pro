export interface CategoryMetadataResult {
  aspects: any | null;
  conditions: any | null;
}

function getLookupEnv(): { url: string; key: string } | null {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return { url, key };
}

export async function callCategoryLookup(
  action: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; data: any | null; status: number }> {
  const env = getLookupEnv();
  if (!env) return { ok: false, data: null, status: 0 };

  const response = await fetch(`${env.url}/functions/v1/category-lookup`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, ...payload }),
  });

  if (!response.ok) {
    return { ok: false, data: null, status: response.status };
  }

  try {
    const text = await response.text();
    return {
      ok: true,
      data: text ? JSON.parse(text) : null,
      status: response.status,
    };
  } catch {
    return { ok: true, data: null, status: response.status };
  }
}

export async function fetchCategoryMetadata(
  categoryId: string,
): Promise<CategoryMetadataResult> {
  const [aspectsResp, conditionsResp] = await Promise.all([
    callCategoryLookup("aspects", { categoryId }),
    callCategoryLookup("conditions", { categoryId }),
  ]);

  return {
    aspects: aspectsResp.ok ? aspectsResp.data : null,
    conditions: conditionsResp.ok ? conditionsResp.data : null,
  };
}
