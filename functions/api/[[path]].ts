interface Env {
  DB: D1Database;
  ADMIN_TOKEN?: string;
}

type CycleUnit = "day" | "month" | "year";
type VpsStatus = "active" | "inactive";

interface VpsRow {
  id: string;
  provider: string;
  plan_name: string;
  price: number;
  currency: string;
  expires_at: string;
  cycle_count: number;
  cycle_unit: CycleUnit;
  quantity: number;
  category: string;
  vendor_url: string | null;
  status: VpsStatus;
  deactivated_at: string | null;
  created_at: string;
  updated_at: string;
}

interface Rates {
  base: "CNY";
  rates: Record<string, number>;
  updatedAt: string | null;
  nextUpdateAt: string | null;
  sourceName: string;
  sourceUrl: string;
  error?: string;
}

interface ValidatedVpsInput {
  provider?: string;
  planName?: string;
  price?: number;
  currency?: string;
  expiresAt?: string;
  cycleCount?: number;
  cycleUnit?: CycleUnit;
  quantity?: number;
  category?: string;
  vendorUrl?: string | null;
}

const EXCHANGE_RATE_URL = "https://open.er-api.com/v6/latest/CNY";
const EXCHANGE_RATE_ATTRIBUTION = "https://www.exchangerate-api.com";
const CACHE_TTL_SECONDS = 60 * 60;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CYCLE_UNITS = new Set<CycleUnit>(["day", "month", "year"]);

class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  try {
    if (parts[0] === "health") {
      return json({
        ok: true,
        authRequired: Boolean(env.ADMIN_TOKEN),
        dbConfigured: Boolean(env.DB)
      });
    }

    assertDb(env);
    assertAuthorized(request, env);

    if (parts[0] === "rates" && parts.length === 1) {
      assertMethod(request, ["GET"]);
      return json({ rates: await getRates() });
    }

    if (parts[0] === "vps") {
      return handleVps(request, env, parts);
    }

    throw new ApiError(404, "not_found", "接口不存在");
  } catch (error) {
    if (error instanceof ApiError) {
      return json(
        {
          error: {
            code: error.code,
            message: error.message,
            details: error.details
          }
        },
        error.status
      );
    }

    console.error(error);
    return json(
      {
        error: {
          code: "internal_error",
          message: "服务器暂时不可用"
        }
      },
      500
    );
  }
};

async function handleVps(request: Request, env: Env, parts: string[]): Promise<Response> {
  if (parts.length === 1) {
    if (request.method === "GET") {
      const url = new URL(request.url);
      const status = url.searchParams.get("status") ?? "active";
      return listVps(env, status);
    }

    if (request.method === "POST") {
      const input = validateVpsInput(await readJson(request), false);
      const now = new Date().toISOString();
      const id = crypto.randomUUID();

      await env.DB.prepare(
        `INSERT INTO vps (
          id, provider, plan_name, price, currency, expires_at,
          cycle_count, cycle_unit, quantity, category, vendor_url,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
      )
        .bind(
          id,
          input.provider,
          input.planName,
          input.price,
          input.currency,
          input.expiresAt,
          input.cycleCount,
          input.cycleUnit,
          input.quantity,
          input.category,
          input.vendorUrl,
          now,
          now
        )
        .run();

      return json({ item: await getVpsDto(env, id) }, 201);
    }
  }

  const id = decodeURIComponent(parts[1] ?? "");
  if (!id) {
    throw new ApiError(404, "not_found", "VPS 不存在");
  }

  if (parts.length === 2) {
    if (request.method === "PATCH") {
      const input = validateVpsInput(await readJson(request), true);
      const entries = toDbUpdateEntries(input);

      if (entries.length === 0) {
        return json({ item: await getVpsDto(env, id) });
      }

      const assignments = entries.map(([column]) => `${column} = ?`);
      const values = entries.map(([, value]) => value);

      const result = await env.DB.prepare(
        `UPDATE vps SET ${assignments.join(", ")}, updated_at = ? WHERE id = ?`
      )
        .bind(...values, new Date().toISOString(), id)
        .run();

      assertChanged(result, "VPS 不存在");
      return json({ item: await getVpsDto(env, id) });
    }

    if (request.method === "DELETE") {
      const row = await getVpsRow(env, id);
      if (!row) {
        throw new ApiError(404, "not_found", "VPS 不存在");
      }

      if (row.status !== "inactive") {
        throw new ApiError(409, "must_deactivate_first", "需要先停用 VPS，才能删除");
      }

      await env.DB.prepare("DELETE FROM vps WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
  }

  if (parts.length === 3 && request.method === "POST") {
    const action = parts[2];

    if (action === "deactivate") {
      const result = await env.DB.prepare(
        `UPDATE vps
         SET status = 'inactive', deactivated_at = ?, updated_at = ?
         WHERE id = ? AND status = 'active'`
      )
        .bind(new Date().toISOString(), new Date().toISOString(), id)
        .run();

      assertChanged(result, "VPS 不存在或已停用");
      return json({ item: await getVpsDto(env, id) });
    }

    if (action === "restore") {
      const result = await env.DB.prepare(
        `UPDATE vps
         SET status = 'active', deactivated_at = NULL, updated_at = ?
         WHERE id = ? AND status = 'inactive'`
      )
        .bind(new Date().toISOString(), id)
        .run();

      assertChanged(result, "VPS 不存在或未停用");
      return json({ item: await getVpsDto(env, id) });
    }

    if (action === "renew") {
      const row = await getVpsRow(env, id);
      if (!row) {
        throw new ApiError(404, "not_found", "VPS 不存在");
      }

      const nextExpiresAt = addCycle(row.expires_at, row.cycle_count, row.cycle_unit);
      const result = await env.DB.prepare(
        "UPDATE vps SET expires_at = ?, updated_at = ? WHERE id = ?"
      )
        .bind(nextExpiresAt, new Date().toISOString(), id)
        .run();

      assertChanged(result, "VPS 不存在");
      return json({ item: await getVpsDto(env, id) });
    }
  }

  throw new ApiError(405, "method_not_allowed", "请求方法不支持");
}

async function listVps(env: Env, status: string): Promise<Response> {
  const normalizedStatus = status.toLowerCase();
  const rates = await getRates();
  let rows: VpsRow[];

  if (normalizedStatus === "all") {
    const result = await env.DB.prepare(
      "SELECT * FROM vps ORDER BY status ASC, expires_at ASC, provider ASC"
    ).all<VpsRow>();
    rows = result.results ?? [];
  } else if (normalizedStatus === "active" || normalizedStatus === "inactive") {
    const result = await env.DB.prepare(
      "SELECT * FROM vps WHERE status = ? ORDER BY expires_at ASC, provider ASC"
    )
      .bind(normalizedStatus)
      .all<VpsRow>();
    rows = result.results ?? [];
  } else {
    throw new ApiError(400, "invalid_status", "status 只能是 active、inactive 或 all");
  }

  const items = rows.map((row) => toDto(row, rates));
  const summaryItems =
    normalizedStatus === "inactive"
      ? (await getRowsByStatus(env, "active")).map((row) => toDto(row, rates))
      : items;

  return json({
    items,
    summary: summarize(summaryItems),
    rates
  });
}

async function getRowsByStatus(env: Env, status: VpsStatus): Promise<VpsRow[]> {
  const result = await env.DB.prepare(
    "SELECT * FROM vps WHERE status = ? ORDER BY expires_at ASC, provider ASC"
  )
    .bind(status)
    .all<VpsRow>();

  return result.results ?? [];
}

async function getVpsDto(env: Env, id: string) {
  const row = await getVpsRow(env, id);
  if (!row) {
    throw new ApiError(404, "not_found", "VPS 不存在");
  }

  return toDto(row, await getRates());
}

async function getVpsRow(env: Env, id: string): Promise<VpsRow | null> {
  return env.DB.prepare("SELECT * FROM vps WHERE id = ?").bind(id).first<VpsRow>();
}

function validateVpsInput(raw: unknown, partial: boolean): ValidatedVpsInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ApiError(400, "invalid_body", "请求体必须是 JSON 对象");
  }

  const input = raw as Record<string, unknown>;
  const output: ValidatedVpsInput = {};

  if (has(input, "provider") || !partial) {
    output.provider = readString(input.provider, "商家名称", 1, 80);
  }

  if (has(input, "planName") || !partial) {
    output.planName = readString(input.planName, "套餐名称", 1, 120);
  }

  if (has(input, "price") || !partial) {
    output.price = readNumber(input.price, "价格", 0, 1_000_000_000);
  }

  if (has(input, "currency") || !partial) {
    const currency = readString(input.currency, "货币", 3, 3).toUpperCase();
    if (!CURRENCY_PATTERN.test(currency)) {
      throw new ApiError(400, "invalid_currency", "货币必须是 ISO 4217 三位代码");
    }
    output.currency = currency;
  }

  if (has(input, "expiresAt") || !partial) {
    const expiresAt = readString(input.expiresAt, "到期时间", 10, 10);
    if (!isValidDateOnly(expiresAt)) {
      throw new ApiError(400, "invalid_date", "到期时间必须是有效的 YYYY-MM-DD");
    }
    output.expiresAt = expiresAt;
  }

  if (has(input, "cycleCount") || !partial) {
    output.cycleCount = readInteger(input.cycleCount, "续费周期", 1, 3650);
  }

  if (has(input, "cycleUnit") || !partial) {
    const cycleUnit = readString(input.cycleUnit, "续费周期单位", 1, 12) as CycleUnit;
    if (!CYCLE_UNITS.has(cycleUnit)) {
      throw new ApiError(400, "invalid_cycle_unit", "续费周期单位只能是 day、month 或 year");
    }
    output.cycleUnit = cycleUnit;
  }

  if (has(input, "quantity") || !partial) {
    output.quantity = readInteger(input.quantity, "VPS 总数", 1, 100000);
  }

  if (has(input, "category") || !partial) {
    output.category = readString(input.category ?? "默认", "VPS 分类", 0, 80) || "默认";
  }

  if (has(input, "vendorUrl") || !partial) {
    output.vendorUrl = readOptionalUrl(input.vendorUrl, "商家官网链接");
  }

  return output;
}

function toDbUpdateEntries(input: ValidatedVpsInput): Array<[string, string | number | null]> {
  const entries: Array<[string, string | number | null]> = [];
  const mapping: Array<[keyof ValidatedVpsInput, string]> = [
    ["provider", "provider"],
    ["planName", "plan_name"],
    ["price", "price"],
    ["currency", "currency"],
    ["expiresAt", "expires_at"],
    ["cycleCount", "cycle_count"],
    ["cycleUnit", "cycle_unit"],
    ["quantity", "quantity"],
    ["category", "category"],
    ["vendorUrl", "vendor_url"]
  ];

  for (const [key, column] of mapping) {
    if (input[key] !== undefined) {
      entries.push([column, input[key] ?? null]);
    }
  }

  return entries;
}

function readString(
  value: unknown,
  label: string,
  minLength: number,
  maxLength: number
): string {
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_field", `${label} 必须是文本`);
  }

  const trimmed = value.trim();
  if (trimmed.length < minLength || trimmed.length > maxLength) {
    throw new ApiError(400, "invalid_field", `${label} 长度不正确`);
  }

  return trimmed;
}

function readNumber(value: unknown, label: string, min: number, max: number): number {
  const numberValue = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(numberValue) || numberValue < min || numberValue > max) {
    throw new ApiError(400, "invalid_field", `${label} 必须是有效数字`);
  }
  return Math.round(numberValue * 1000000) / 1000000;
}

function readInteger(value: unknown, label: string, min: number, max: number): number {
  const numberValue = readNumber(value, label, min, max);
  if (!Number.isInteger(numberValue)) {
    throw new ApiError(400, "invalid_field", `${label} 必须是整数`);
  }
  return numberValue;
}

function readOptionalUrl(value: unknown, label: string): string | null {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }

  const raw = readString(value, label, 1, 300);
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("Invalid protocol");
    }
    return url.toString();
  } catch {
    throw new ApiError(400, "invalid_url", `${label} 必须是 http 或 https 链接`);
  }
}

function toDto(row: VpsRow, rates: Rates) {
  const cycleOriginal = roundMoney(row.price * row.quantity);
  const cycleCny = convertToCny(cycleOriginal, row.currency, rates);
  const cycleMonths = getCycleMonths(row.cycle_count, row.cycle_unit);
  const monthlyCny = cycleCny === null ? null : roundMoney(cycleCny / cycleMonths);
  const annualCny = monthlyCny === null ? null : roundMoney(monthlyCny * 12);

  return {
    id: row.id,
    provider: row.provider,
    planName: row.plan_name,
    price: row.price,
    currency: row.currency,
    expiresAt: row.expires_at,
    cycleCount: row.cycle_count,
    cycleUnit: row.cycle_unit,
    quantity: row.quantity,
    category: row.category,
    vendorUrl: row.vendor_url,
    status: row.status,
    deactivatedAt: row.deactivated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresInDays: getDaysUntil(row.expires_at),
    costs: {
      cycleOriginal,
      cycleCny,
      monthlyCny,
      annualCny
    }
  };
}

function summarize(items: ReturnType<typeof toDto>[]) {
  const activeItems = items.filter((item) => item.status === "active");
  const unknownCurrencies = new Set<string>();

  let cycleCny = 0;
  let monthlyCny = 0;
  let annualCny = 0;
  let quantity = 0;

  for (const item of activeItems) {
    quantity += item.quantity;

    if (item.costs.cycleCny === null || item.costs.monthlyCny === null || item.costs.annualCny === null) {
      unknownCurrencies.add(item.currency);
      continue;
    }

    cycleCny += item.costs.cycleCny;
    monthlyCny += item.costs.monthlyCny;
    annualCny += item.costs.annualCny;
  }

  return {
    activeItemCount: activeItems.length,
    activeQuantity: quantity,
    cycleCny: roundMoney(cycleCny),
    monthlyCny: roundMoney(monthlyCny),
    annualCny: roundMoney(annualCny),
    unknownCurrencies: Array.from(unknownCurrencies).sort()
  };
}

async function getRates(): Promise<Rates> {
  const cacheKey = new Request(EXCHANGE_RATE_URL);

  try {
    const cached = await caches.default.match(cacheKey);
    if (cached) {
      return (await cached.json()) as Rates;
    }
  } catch {
    // Cache API is best effort in local development.
  }

  try {
    const response = await fetch(EXCHANGE_RATE_URL, {
      headers: {
        accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Exchange API responded with ${response.status}`);
    }

    const payload = (await response.json()) as {
      result?: string;
      base_code?: string;
      rates?: Record<string, number>;
      time_last_update_utc?: string;
      time_next_update_utc?: string;
    };

    if (payload.result !== "success" || payload.base_code !== "CNY" || !payload.rates?.CNY) {
      throw new Error("Exchange API payload is invalid");
    }

    const rates: Rates = {
      base: "CNY",
      rates: payload.rates,
      updatedAt: payload.time_last_update_utc ?? null,
      nextUpdateAt: payload.time_next_update_utc ?? null,
      sourceName: "ExchangeRate-API",
      sourceUrl: EXCHANGE_RATE_ATTRIBUTION
    };

    try {
      await caches.default.put(
        cacheKey,
        new Response(JSON.stringify(rates), {
          headers: {
            "content-type": "application/json; charset=UTF-8",
            "cache-control": `public, max-age=${CACHE_TTL_SECONDS}`
          }
        })
      );
    } catch {
      // Cache writes can fail in some local environments.
    }

    return rates;
  } catch (error) {
    console.error(error);
    return {
      base: "CNY",
      rates: { CNY: 1 },
      updatedAt: null,
      nextUpdateAt: null,
      sourceName: "ExchangeRate-API",
      sourceUrl: EXCHANGE_RATE_ATTRIBUTION,
      error: "汇率接口暂时不可用，仅能计算 CNY"
    };
  }
}

function convertToCny(amount: number, currency: string, rates: Rates): number | null {
  if (currency === "CNY") {
    return roundMoney(amount);
  }

  const rate = rates.rates[currency];
  if (!rate || rate <= 0) {
    return null;
  }

  return roundMoney(amount / rate);
}

function getCycleMonths(count: number, unit: CycleUnit): number {
  if (unit === "day") {
    return count / 30.4375;
  }

  if (unit === "month") {
    return count;
  }

  return count * 12;
}

function addCycle(dateOnly: string, count: number, unit: CycleUnit): string {
  if (unit === "day") {
    const date = parseDateOnly(dateOnly);
    date.setUTCDate(date.getUTCDate() + count);
    return toDateOnly(date);
  }

  return addMonths(dateOnly, unit === "month" ? count : count * 12);
}

function addMonths(dateOnly: string, months: number): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const targetMonthIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
  const targetMonth = normalizedMonthIndex + 1;
  const maxDay = daysInMonth(targetYear, targetMonth);
  return toDateOnly(new Date(Date.UTC(targetYear, normalizedMonthIndex, Math.min(day, maxDay))));
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function getDaysUntil(dateOnly: string): number {
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const target = parseDateOnly(dateOnly).getTime();
  return Math.ceil((target - todayUtc) / 86400000);
}

function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isValidDateOnly(value: string): boolean {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }

  const date = parseDateOnly(value);
  return toDateOnly(date) === value;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function assertDb(env: Env): void {
  if (!env.DB) {
    throw new ApiError(500, "db_not_configured", "D1 数据库绑定 DB 未配置");
  }
}

function assertAuthorized(request: Request, env: Env): void {
  if (!env.ADMIN_TOKEN) {
    return;
  }

  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  const headerToken = request.headers.get("x-admin-token") ?? "";

  if (bearer !== env.ADMIN_TOKEN && headerToken !== env.ADMIN_TOKEN) {
    throw new ApiError(401, "unauthorized", "需要有效的访问令牌");
  }
}

function assertMethod(request: Request, methods: string[]): void {
  if (!methods.includes(request.method)) {
    throw new ApiError(405, "method_not_allowed", "请求方法不支持");
  }
}

function assertChanged(result: D1Result, message: string): void {
  const changes = Number(result.meta.changes ?? 0);
  if (changes < 1) {
    throw new ApiError(404, "not_found", message);
  }
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "invalid_json", "请求体不是有效 JSON");
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(),
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store"
    }
  });
}

function corsHeaders(): HeadersInit {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, authorization, x-admin-token"
  };
}

function has(input: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}
