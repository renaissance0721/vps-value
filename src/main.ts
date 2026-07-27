import "./styles.css";

type CycleUnit = "day" | "month" | "year";
type CyclePreset = "week" | "month" | "quarter" | "half_year" | "year" | "two_year" | "three_year";
type Route = { page: "home" } | { page: "form"; id: string | null };

interface SubscriptionItem {
  id: string;
  provider: string;
  planName: string;
  price: number;
  currency: string;
  expiresAt: string;
  cycleCount: number;
  cycleUnit: CycleUnit;
  quantity: number;
  category: string;
  note: string;
  vendorUrl: string | null;
  status: "active" | "inactive";
  deactivatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  expiresInDays: number;
  costs: {
    cycleOriginal: number;
    cycleCny: number | null;
    monthlyCny: number | null;
    annualCny: number | null;
    remainingValueCny: number | null;
  };
}

interface Summary {
  activeItemCount: number;
  activeQuantity: number;
  cycleCny: number;
  currentMonthDueCny: number;
  nextMonthDueCny: number;
  monthlyCny: number;
  annualCny: number;
  remainingValueCny: number;
  unknownCurrencies: string[];
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

interface ListResponse {
  items: SubscriptionItem[];
  summary: Summary;
  categories: string[];
  rates: Rates;
}

interface HealthResponse {
  ok: boolean;
  authRequired: boolean;
  dbConfigured: boolean;
}

const appRoot = document.querySelector<HTMLDivElement>("#app");

if (!appRoot) {
  throw new Error("App root is missing");
}

const app = appRoot;

const tokenStorageKey = "vps-value-admin-token";
const currencyOptions = [
  "CNY",
  "USD",
  "EUR",
  "HKD",
  "JPY",
  "GBP",
  "SGD",
  "AUD",
  "CAD",
  "TWD",
  "KRW",
  "MYR",
  "THB",
  "TRY",
  "PHP",
  "IDR",
  "VND",
  "INR"
];

const cycleUnitLabels: Record<CycleUnit, string> = {
  day: "天",
  month: "月",
  year: "年"
};

const cyclePresetOptions: Array<{
  value: CyclePreset;
  label: string;
  cycleCount: number;
  cycleUnit: CycleUnit;
}> = [
  { value: "week", label: "周", cycleCount: 7, cycleUnit: "day" },
  { value: "month", label: "月", cycleCount: 1, cycleUnit: "month" },
  { value: "quarter", label: "季", cycleCount: 3, cycleUnit: "month" },
  { value: "half_year", label: "半年", cycleCount: 6, cycleUnit: "month" },
  { value: "year", label: "年", cycleCount: 1, cycleUnit: "year" },
  { value: "two_year", label: "二年", cycleCount: 2, cycleUnit: "year" },
  { value: "three_year", label: "三年", cycleCount: 3, cycleUnit: "year" }
];

const state: {
  token: string;
  authRequired: boolean;
  dbConfigured: boolean;
  categoryFilter: string;
  categories: string[];
  items: SubscriptionItem[];
  summary: Summary | null;
  rates: Rates | null;
  loading: boolean;
  error: string;
  notice: string;
  editingId: string | null;
} = {
  token: localStorage.getItem(tokenStorageKey) ?? "",
  authRequired: true,
  dbConfigured: true,
  categoryFilter: "",
  categories: [],
  items: [],
  summary: null,
  rates: null,
  loading: false,
  error: "",
  notice: "",
  editingId: null
};

window.addEventListener("hashchange", () => {
  state.error = "";
  render();
  window.scrollTo({ top: 0, behavior: "auto" });
});

void init();

async function init(): Promise<void> {
  render();

  try {
    const health = await apiFetch<HealthResponse>("/api/health", {}, false);
    state.authRequired = health.authRequired;
    state.dbConfigured = health.dbConfigured;
  } catch {
    state.error = "无法连接 Pages Functions，请使用 Cloudflare Pages 环境运行。";
    render();
    return;
  }

  await loadItems();
}

async function loadItems(): Promise<void> {
  state.loading = true;
  state.error = "";
  render();

  try {
    const query = state.categoryFilter
      ? `?category=${encodeURIComponent(state.categoryFilter)}`
      : "";
    const data = await apiFetch<ListResponse>(`/api/subscriptions${query}`);
    state.items = data.items;
    state.summary = data.summary;
    state.categories = data.categories;
    state.rates = data.rates;
  } catch (error) {
    state.error = getErrorMessage(error);
  } finally {
    state.loading = false;
    render();
  }
}

function render(): void {
  const route = getRoute();
  const editingItem = route.page === "form" && route.id
    ? state.items.find((item) => item.id === route.id) ?? null
    : null;

  app.innerHTML = `
    <main class="shell ${route.page === "home" ? "home-shell" : "form-shell"}">
      <header class="topbar">
        <div>
          <h1>夕凪の订阅</h1>
          <p>线上付费订阅聚合</p>
        </div>
        ${renderAuth()}
      </header>

      ${renderMessage()}
      ${route.page === "home" ? `${renderSummary()}${renderHomePage()}` : renderFormPage(editingItem, route.id)}

      <footer class="footer">
        <span>汇率来源：</span>
        <a href="${h(state.rates?.sourceUrl ?? "https://www.exchangerate-api.com")}" target="_blank" rel="noreferrer">
          ${h(state.rates?.sourceName ?? "ExchangeRate-API")}
        </a>
      </footer>
    </main>
  `;

  bindEvents();
}

function renderAuth(): string {
  if (!state.authRequired) {
    return `<div class="auth-note">未启用令牌</div>`;
  }

  return `
    <details class="auth-panel">
      <summary>
        <span class="auth-indicator" aria-hidden="true"></span>
        ${state.token ? "令牌已保存" : "访问设置"}
      </summary>
      <form class="auth-form" id="auth-form">
        <label for="admin-token">访问令牌</label>
        <input
          id="admin-token"
          name="token"
          type="password"
          autocomplete="current-password"
          value="${h(state.token)}"
          placeholder="输入 ADMIN_TOKEN"
        />
        <div class="auth-actions">
          <button type="submit">保存</button>
          <button class="ghost" id="clear-token" type="button">清除</button>
        </div>
      </form>
    </details>
  `;
}

function renderMessage(): string {
  const pieces: string[] = [];

  if (!state.dbConfigured) {
    pieces.push(`<div class="message error">D1 数据库绑定 DB 未配置。</div>`);
  }

  if (state.error) {
    pieces.push(`<div class="message error">${h(state.error)}</div>`);
  }

  if (state.notice) {
    pieces.push(`<div class="message ok">${h(state.notice)}</div>`);
  }

  if (state.rates?.error) {
    pieces.push(`<div class="message warning">${h(state.rates.error)}</div>`);
  }

  if (state.summary?.unknownCurrencies.length) {
    pieces.push(
      `<div class="message warning">以下货币暂时无法换算：${state.summary.unknownCurrencies
        .map(h)
        .join("、")}</div>`
    );
  }

  return pieces.join("");
}

function renderHomePage(): string {
  return `
    <section class="home-page">
      <section class="panel list-panel">
        <div class="panel-heading list-heading">
          <div>
            <h2>订阅记录</h2>
            <p class="record-count">${state.items.length ? `共 ${state.items.length} 条` : "集中管理续费日期与成本"}</p>
          </div>
          <div class="list-tools">
            <select class="category-filter" id="category-filter" aria-label="按分类筛选">
              <option value="">全部分类</option>
              ${state.categories
                .map(
                  (category) => `
                    <option value="${h(category)}" ${category === state.categoryFilter ? "selected" : ""}>
                      ${h(category)}
                    </option>
                  `
                )
                .join("")}
            </select>
            <button id="new-subscription" type="button" aria-label="新增订阅">
              <span aria-hidden="true">＋</span><span class="new-button-label">新增订阅</span>
            </button>
          </div>
        </div>
        <div class="list-scroll">
          ${renderTable()}
        </div>
      </section>
    </section>
  `;
}

function renderFormPage(item: SubscriptionItem | null, id: string | null): string {
  if (id && !item) {
    return `
      <section class="form-page">
        <section class="panel form-panel">
          <div class="panel-heading">
            <h2>修改订阅</h2>
            <button class="ghost" id="back-home" type="button">返回主页</button>
          </div>
          <div class="table-state">${state.loading ? "加载中..." : "未找到这条订阅记录"}</div>
        </section>
      </section>
    `;
  }

  return `
    <section class="form-page">
      <section class="panel form-panel">
        <div class="panel-heading">
          <h2>${item ? "修改订阅" : "新增订阅"}</h2>
          <button class="ghost" id="back-home" type="button">返回主页</button>
        </div>
        ${renderForm(item)}
      </section>
    </section>
  `;
}

function renderSummary(): string {
  const summary = state.summary;

  return `
    <section class="summary-grid" aria-label="费用汇总">
      <article class="summary-primary">
        <span>本月需花费</span>
        <strong>${summary ? formatCny(summary.currentMonthDueCny) : "-"}</strong>
        <small>本自然月到期需续费</small>
      </article>
      <article>
        <span>下月续费</span>
        <strong>${summary ? formatCny(summary.nextMonthDueCny) : "-"}</strong>
        <small>下个自然月到期需续费</small>
      </article>
      <article>
        <span>月均成本</span>
        <strong>${summary ? formatCny(summary.monthlyCny) : "-"}</strong>
        <small>统一折算为 CNY</small>
      </article>
      <article>
        <span>年均成本</span>
        <strong>${summary ? formatCny(summary.annualCny) : "-"}</strong>
        <small>${formatRateTime(state.rates?.updatedAt)}</small>
      </article>
      <article>
        <span>剩余价值</span>
        <strong>${summary ? formatCny(summary.remainingValueCny) : "-"}</strong>
        <small>按剩余天数自动折算</small>
      </article>
      <article>
        <span>订阅数量</span>
        <strong>${summary ? summary.activeQuantity : "-"}</strong>
        <small>${summary ? `${summary.activeItemCount} 条记录` : "等待加载"}</small>
      </article>
    </section>
  `;
}

function renderForm(item: SubscriptionItem | null): string {
  const provider = item?.provider ?? "";
  const planName = item?.planName ?? "";
  const price = item?.price ?? "";
  const currency = item?.currency ?? "USD";
  const expiresAt = item?.expiresAt ?? defaultExpiryDate();
  const cyclePreset = item ? getCyclePresetValue(item.cycleCount, item.cycleUnit) : "month";
  const quantity = item?.quantity ?? 1;
  const category = item?.category ?? state.categoryFilter;
  const categoryOptions = Array.from(
    new Set([...state.categories, ...(category ? [category] : [])])
  );
  const hasCategoryOptions = categoryOptions.length > 0;
  const categoryChoice = category || (hasCategoryOptions ? "" : "__new_category__");
  const isCreatingCategory = categoryChoice === "__new_category__";
  const note = item?.note ?? "";
  const vendorUrl = item?.vendorUrl ?? "";

  return `
    <form class="subscription-form" id="subscription-form">
      <div class="field">
        <label for="provider">服务商名称</label>
        <input id="provider" name="provider" required maxlength="80" value="${h(provider)}" />
      </div>

      <div class="field">
        <label for="plan-name">订阅名称</label>
        <input id="plan-name" name="planName" required maxlength="120" value="${h(planName)}" />
      </div>

      <div class="form-row">
        <div class="field">
          <label for="price">价格</label>
          <input id="price" name="price" required min="0" step="0.000001" type="number" value="${h(String(price))}" />
        </div>
        <div class="field">
          <label for="currency">货币</label>
          <select id="currency" name="currency">
            ${currencyOptions
              .map(
                (option) => `
                  <option value="${option}" ${option === currency ? "selected" : ""}>${option}</option>
                `
              )
              .join("")}
          </select>
        </div>
      </div>

      <div class="field">
        <label for="currency-preview">折合人民币</label>
        <div class="currency-preview-box" id="currency-preview" role="status">
          ${h(getCurrencyPreviewText(Number(price) || 0, currency, Number(quantity) || 1))}
        </div>
      </div>

      <div class="form-row">
        <div class="field">
          <label for="expires-at">到期时间</label>
          <input id="expires-at" name="expiresAt" required type="date" value="${h(expiresAt)}" />
        </div>
        <div class="field">
          <label for="quantity">订阅数量</label>
          <input id="quantity" name="quantity" required min="1" step="1" type="number" value="${h(String(quantity))}" />
        </div>
      </div>

      <div class="field">
        <label for="cycle-preset">续费周期</label>
        <select id="cycle-preset" name="cyclePreset">
          ${cyclePresetOptions
            .map(
              (option) => `
                <option value="${option.value}" ${option.value === cyclePreset ? "selected" : ""}>${option.label}</option>
              `
            )
            .join("")}
        </select>
      </div>

      <div class="field">
        <label for="category-choice">分类</label>
        <div class="category-entry">
          <select id="category-choice" name="categoryChoice" required>
            ${
              hasCategoryOptions
                ? `<option value="" ${categoryChoice ? "" : "selected"} disabled>请选择分类</option>`
                : ""
            }
            ${categoryOptions
              .map(
                (option) => `
                  <option value="${h(option)}" ${option === categoryChoice ? "selected" : ""}>
                    ${h(option)}
                  </option>
                `
              )
              .join("")}
            <option value="__new_category__" ${isCreatingCategory ? "selected" : ""}>＋ 新建分类</option>
          </select>
          <input
            id="new-category"
            name="newCategory"
            maxlength="80"
            placeholder="输入新分类名称"
            ${isCreatingCategory ? "required" : "hidden"}
          />
        </div>
      </div>

      <div class="field">
        <label for="note">备注</label>
        <input id="note" name="note" maxlength="300" value="${h(note)}" placeholder="可选" />
      </div>

      <div class="field">
        <label for="vendor-url">官网链接</label>
        <input id="vendor-url" name="vendorUrl" maxlength="300" type="url" value="${h(vendorUrl)}" placeholder="https://" />
      </div>

      <div class="form-actions">
        <button type="submit">${item ? "保存修改" : "新增"}</button>
        ${item ? `<button class="ghost" id="cancel-edit" type="button">取消</button>` : ""}
      </div>
    </form>
  `;
}

function renderTable(): string {
  if (state.loading) {
    return `<div class="table-state">加载中...</div>`;
  }

  if (state.items.length === 0) {
    return `<div class="table-state">暂无记录</div>`;
  }

  return `
    <div class="table-wrap desktop-table">
      <table>
        <thead>
          <tr>
            <th>订阅</th>
            <th>分类</th>
            <th>价格</th>
            <th>续费</th>
            <th>到期</th>
            <th>CNY</th>
            <th>剩余价值</th>
            <th>状态</th>
            <th>备注</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${state.items.map(renderRow).join("")}
        </tbody>
      </table>
    </div>
    <div class="mobile-subscription-list" aria-label="订阅记录">
      ${state.items.map(renderMobileCard).join("")}
    </div>
  `;
}

function renderMobileCard(item: SubscriptionItem): string {
  const expiryClass = getExpiryClass(item.expiresInDays);

  return `
    <article class="subscription-card">
      <div class="subscription-card-head">
        <div class="subscription-name">
          <strong>${h(item.provider)}</strong>
          <span>${h(item.planName)}</span>
        </div>
        ${renderSubscriptionStatus(item.expiresInDays)}
      </div>

      <div class="subscription-card-price">
        <strong>${formatMoney(item.price, item.currency)}</strong>
        <span>${h(formatCycle(item.cycleCount, item.cycleUnit))}付${item.quantity > 1 ? ` · ${item.quantity} 份` : ""}</span>
      </div>

      <div class="subscription-card-meta">
        <div>
          <span>到期</span>
          <strong class="expiry ${expiryClass}">${h(formatExpiry(item.expiresInDays))}</strong>
          <small>${h(item.expiresAt)}</small>
        </div>
        <div>
          <span>月均</span>
          <strong>${formatMaybeCny(item.costs.monthlyCny)}</strong>
          <small>剩余 ${formatMaybeCny(item.costs.remainingValueCny)}</small>
        </div>
      </div>

      <div class="subscription-card-tags">
        <span>${h(item.category)}</span>
        ${item.note ? `<span class="card-note">${h(item.note)}</span>` : ""}
      </div>

      <div class="subscription-card-actions">
        ${item.vendorUrl ? `<a class="card-action-link" href="${h(item.vendorUrl)}" target="_blank" rel="noreferrer">官网</a>` : `<span class="card-action-placeholder">官网</span>`}
        <button type="button" data-action="edit" data-id="${h(item.id)}">编辑</button>
        <button class="ghost" type="button" data-action="renew" data-id="${h(item.id)}">续费</button>
        <button class="compact-danger" type="button" data-action="delete" data-id="${h(item.id)}">删除</button>
      </div>
    </article>
  `;
}

function renderRow(item: SubscriptionItem): string {
  const expiryClass = getExpiryClass(item.expiresInDays);

  return `
    <tr>
      <td>
        <div class="subscription-name">
          <strong>${h(item.provider)}</strong>
          <span>${h(item.planName)}</span>
        </div>
      </td>
      <td>${h(item.category)}</td>
      <td>
        <div class="price-cell">
          <span>${formatMoney(item.price, item.currency)}</span>
          <small>x ${item.quantity}</small>
        </div>
      </td>
      <td>${h(formatCycle(item.cycleCount, item.cycleUnit))}</td>
      <td>
        <div class="expiry ${expiryClass}">
          <span>${h(item.expiresAt)}</span>
          <small>${h(formatExpiry(item.expiresInDays))}</small>
        </div>
      </td>
      <td>
        <div class="price-cell">
          <span>${formatMaybeCny(item.costs.cycleCny)}</span>
          <small>月均 ${formatMaybeCny(item.costs.monthlyCny)}</small>
        </div>
      </td>
      <td>${formatMaybeCny(item.costs.remainingValueCny)}</td>
      <td>${renderSubscriptionStatus(item.expiresInDays)}</td>
      <td>${item.note ? h(item.note) : "-"}</td>
      <td>
        <div class="row-actions">
          ${item.vendorUrl ? `<a class="link-button" href="${h(item.vendorUrl)}" target="_blank" rel="noreferrer">官网</a>` : ""}
          <button class="small" type="button" data-action="edit" data-id="${h(item.id)}">编辑</button>
          <button class="small" type="button" data-action="renew" data-id="${h(item.id)}">续费</button>
          <button class="small danger" type="button" data-action="delete" data-id="${h(item.id)}">删除</button>
        </div>
      </td>
    </tr>
  `;
}

function renderSubscriptionStatus(expiresInDays: number): string {
  if (expiresInDays < 0) {
    return `<span class="status danger">已过期</span>`;
  }

  if (expiresInDays <= 10) {
    return `<span class="status warning">即将到期</span>`;
  }

  return `<span class="status active">订阅中</span>`;
}

function getRoute(): Route {
  const hash = decodeURIComponent(location.hash.replace(/^#\/?/, ""));

  if (hash === "new") {
    return { page: "form", id: null };
  }

  if (hash.startsWith("edit/")) {
    const id = hash.slice(5).trim();
    return id ? { page: "form", id } : { page: "home" };
  }

  return { page: "home" };
}

function navigateToForm(id: string | null): void {
  location.hash = id ? `#/edit/${encodeURIComponent(id)}` : "#/new";
}

function navigateHome(shouldRender = true): void {
  if (location.hash) {
    history.pushState("", document.title, `${location.pathname}${location.search}`);
  }

  if (shouldRender) {
    render();
  }

  window.scrollTo({ top: 0, behavior: "auto" });
}

function bindEvents(): void {
  document.querySelector<HTMLButtonElement>("#new-subscription")?.addEventListener("click", () => {
    navigateToForm(null);
  });

  document.querySelector<HTMLButtonElement>("#back-home")?.addEventListener("click", () => {
    navigateHome();
  });

  document.querySelector<HTMLFormElement>("#auth-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget as HTMLFormElement);
    state.token = String(formData.get("token") ?? "").trim();

    if (state.token) {
      localStorage.setItem(tokenStorageKey, state.token);
    } else {
      localStorage.removeItem(tokenStorageKey);
    }

    state.notice = "访问令牌已保存";
    void loadItems();
  });

  document.querySelector<HTMLButtonElement>("#clear-token")?.addEventListener("click", () => {
    state.token = "";
    localStorage.removeItem(tokenStorageKey);
    state.notice = "访问令牌已清除";
    void loadItems();
  });

  document.querySelector<HTMLFormElement>("#subscription-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveSubscription(event.currentTarget as HTMLFormElement);
  });

  bindCurrencyPreview();
  bindCategoryChoice();

  document.querySelector<HTMLButtonElement>("#cancel-edit")?.addEventListener("click", () => {
    state.editingId = null;
    state.notice = "";
    navigateHome();
  });

  document.querySelector<HTMLSelectElement>("#category-filter")?.addEventListener("change", (event) => {
    state.categoryFilter = (event.currentTarget as HTMLSelectElement).value;
    state.editingId = null;
    state.notice = "";
    void loadItems();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.action ?? "";
      const id = button.dataset.id ?? "";
      void handleAction(action, id);
    });
  });
}

async function saveSubscription(form: HTMLFormElement): Promise<void> {
  const route = getRoute();
  const editingId = route.page === "form" ? route.id : null;
  const formData = new FormData(form);
  const cycle = getCyclePreset(String(formData.get("cyclePreset") ?? "month"));
  const categoryChoice = String(formData.get("categoryChoice") ?? "");
  const category =
    categoryChoice === "__new_category__"
      ? String(formData.get("newCategory") ?? "")
      : categoryChoice;
  const payload = {
    provider: String(formData.get("provider") ?? ""),
    planName: String(formData.get("planName") ?? ""),
    price: Number(formData.get("price")),
    currency: String(formData.get("currency") ?? "USD"),
    expiresAt: String(formData.get("expiresAt") ?? ""),
    cycleCount: cycle.cycleCount,
    cycleUnit: cycle.cycleUnit,
    quantity: Number(formData.get("quantity")),
    category,
    note: String(formData.get("note") ?? ""),
    vendorUrl: String(formData.get("vendorUrl") ?? "")
  };

  try {
    if (editingId) {
      await apiFetch(`/api/subscriptions/${encodeURIComponent(editingId)}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      state.notice = "订阅已更新";
    } else {
      await apiFetch("/api/subscriptions", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      state.notice = "订阅已新增";
      form.reset();
    }

    if (state.categoryFilter && state.categoryFilter !== payload.category.trim()) {
      state.categoryFilter = payload.category.trim();
    }

    navigateHome(false);
    await loadItems();
  } catch (error) {
    state.error = getErrorMessage(error);
    render();
  }
}

async function handleAction(action: string, id: string): Promise<void> {
  const item = state.items.find((candidate) => candidate.id === id);

  if (!item) {
    return;
  }

  if (action === "edit") {
    state.editingId = null;
    state.notice = "";
    navigateToForm(id);
    return;
  }

  try {
    if (action === "renew") {
      await apiFetch(`/api/subscriptions/${encodeURIComponent(id)}/renew`, { method: "POST" });
      state.notice = "到期时间已顺延一个续费周期";
    }

    if (action === "delete") {
      if (!confirm(`永久删除 ${item.provider} / ${item.planName}？此操作无法撤销。`)) {
        return;
      }
      await apiFetch(`/api/subscriptions/${encodeURIComponent(id)}`, { method: "DELETE" });
      state.notice = "订阅已删除";
    }

    await loadItems();
  } catch (error) {
    state.error = getErrorMessage(error);
    render();
  }
}

function bindCategoryChoice(): void {
  const categorySelect = document.querySelector<HTMLSelectElement>("#category-choice");
  const newCategoryInput = document.querySelector<HTMLInputElement>("#new-category");

  if (!categorySelect || !newCategoryInput) {
    return;
  }

  categorySelect.addEventListener("change", () => {
    const isCreating = categorySelect.value === "__new_category__";
    newCategoryInput.hidden = !isCreating;
    newCategoryInput.required = isCreating;

    if (isCreating) {
      newCategoryInput.focus();
    } else {
      newCategoryInput.value = "";
    }
  });
}

function bindCurrencyPreview(): void {
  const priceInput = document.querySelector<HTMLInputElement>("#price");
  const currencySelect = document.querySelector<HTMLSelectElement>("#currency");
  const quantityInput = document.querySelector<HTMLInputElement>("#quantity");
  const preview = document.querySelector<HTMLDivElement>("#currency-preview");

  if (!priceInput || !currencySelect || !quantityInput || !preview) {
    return;
  }

  const update = () => {
    preview.textContent = getCurrencyPreviewText(
      Number(priceInput.value) || 0,
      currencySelect.value,
      Number(quantityInput.value) || 1
    );
  };

  priceInput.addEventListener("input", update);
  currencySelect.addEventListener("change", update);
  quantityInput.addEventListener("input", update);
  update();
}

function getCyclePreset(value: string) {
  return cyclePresetOptions.find((option) => option.value === value) ?? cyclePresetOptions[1];
}

function getCyclePresetValue(count: number, unit: CycleUnit): CyclePreset {
  return (
    cyclePresetOptions.find(
      (option) => option.cycleCount === count && option.cycleUnit === unit
    )?.value ?? "month"
  );
}

function formatCycle(count: number, unit: CycleUnit): string {
  const preset = cyclePresetOptions.find(
    (option) => option.cycleCount === count && option.cycleUnit === unit
  );

  if (preset) {
    return preset.label;
  }

  return `${count} ${cycleUnitLabels[unit]}`;
}

function getCurrencyPreviewText(price: number, currency: string, quantity: number): string {
  const cny = convertToCny(price * quantity, currency);
  return cny === null ? "无法换算" : `${formatPlainCny(cny)} 元`;
}

function convertToCny(amount: number, currency: string): number | null {
  if (!Number.isFinite(amount)) {
    return 0;
  }

  if (currency === "CNY") {
    return roundMoney(amount);
  }

  const rate = state.rates?.rates[currency];
  if (!rate || rate <= 0) {
    return null;
  }

  return roundMoney(amount / rate);
}

async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  includeAuth = true
): Promise<T> {
  const headers = new Headers(init.headers);

  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  if (includeAuth && state.token) {
    headers.set("authorization", `Bearer ${state.token}`);
  }

  const response = await fetch(path, {
    ...init,
    headers
  });

  const payload = (await response.json().catch(() => null)) as
    | { error?: { message?: string } }
    | T
    | null;

  if (!response.ok) {
    if (response.status === 401) {
      state.authRequired = true;
    }

    const message =
      payload && typeof payload === "object" && "error" in payload && payload.error?.message
        ? payload.error.message
        : `请求失败：${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败";
}

function defaultExpiryDate(): string {
  const date = new Date();
  date.setMonth(date.getMonth() + 1);
  return toDateInputValue(date);
}

function toDateInputValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function formatCny(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 2
  }).format(value);
}

function formatPlainCny(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatMaybeCny(value: number | null): string {
  return value === null ? "无法换算" : formatCny(value);
}

function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function formatRateTime(value?: string | null): string {
  if (!value) {
    return "汇率更新时间未知";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return `汇率 ${value}`;
  }

  return `汇率 ${date.toLocaleString("zh-CN")}`;
}

function formatExpiry(days: number): string {
  if (days < 0) {
    return `已过期 ${Math.abs(days)} 天`;
  }

  if (days === 0) {
    return "今天到期";
  }

  return `剩余 ${days} 天`;
}

function getExpiryClass(days: number): string {
  if (days < 0) {
    return "expired";
  }

  if (days <= 10) {
    return "warning";
  }

  return "ok";
}

function h(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
