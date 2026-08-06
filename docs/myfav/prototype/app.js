const records = [
  {
    id: "agent-skill",
    type: "article",
    title: "如何构建可靠的 Agent Skill",
    description: "一份关于工作流、数据边界与验证方式的实践。",
    category: "Agent 开发",
    tags: ["AI", "skill", "workflow"],
    date: "2026-08-06",
    author: "Cloudflare",
    href: "#/article/2026-08/agent-skill",
  },
  {
    id: "cloudflare-skills",
    type: "repo",
    title: "cloudflare/skills",
    description: "Cloudflare 官方 Agent Skills 与工作流示例。",
    category: "Agent 开发",
    tags: ["skill", "cloudflare", "AI"],
    date: "2026-08-06",
    stars: "1.6k ★",
    href: "https://github.com/cloudflare/skills",
  },
  {
    id: "linear",
    type: "site",
    title: "Linear",
    description: "快速、克制的项目管理与协作工具。",
    category: "开发工具",
    tags: ["项目管理", "效率"],
    date: "2026-08-05",
    href: "https://linear.app",
  },
  {
    id: "local-first",
    type: "article",
    title: "Local-first software: you own your data",
    description: "重新理解数据所有权、协作和本地优先软件。",
    category: "软件设计",
    tags: ["local-first", "架构"],
    date: "2026-08-04",
    author: "Ink & Switch",
    href: "#/article/2026-08/agent-skill",
  },
  {
    id: "raycast",
    type: "site",
    title: "Raycast",
    description: "面向 macOS 的启动器与自动化工作台。",
    category: "效率",
    tags: ["macOS", "效率", "自动化"],
    date: "2026-08-03",
    href: "https://www.raycast.com",
  },
  {
    id: "readability",
    type: "repo",
    title: "mozilla/readability",
    description: "Firefox Reader View 使用的独立可读性解析库。",
    category: "内容处理",
    tags: ["reader", "parser", "JavaScript"],
    date: "2026-08-02",
    stars: "10.2k ★",
    href: "https://github.com/mozilla/readability",
  },
  {
    id: "are-na",
    type: "site",
    title: "Are.na",
    description: "为研究和创作建立持久、互相关联的内容集合。",
    category: "设计",
    tags: ["研究", "灵感", "设计"],
    date: "2026-07-30",
    href: "https://www.are.na",
  },
  {
    id: "web-design",
    type: "article",
    title: "A Dao of Web Design",
    description: "经典网页设计文章：让网页适应媒介，而不是控制媒介。",
    category: "设计",
    tags: ["Web", "设计", "响应式"],
    date: "2026-07-28",
    author: "John Allsopp",
    href: "#/article/2026-08/agent-skill",
  },
  {
    id: "defuddle",
    type: "repo",
    title: "kepano/defuddle",
    description: "从网页中提取主要内容并转为更干净的 HTML。",
    category: "内容处理",
    tags: ["parser", "markdown", "reader"],
    date: "2026-07-26",
    stars: "4.1k ★",
    href: "https://github.com/kepano/defuddle",
  },
];

const typeNames = {
  site: "网站",
  repo: "GitHub",
  article: "文章",
};

const routeMeta = {
  sites: {
    type: "site",
    title: "网站",
    description: "发现与开发、设计和效率有关的网站。",
    total: 82,
  },
  repos: {
    type: "repo",
    title: "GitHub",
    description: "值得阅读、使用和持续关注的开源仓库。",
    total: 136,
  },
  articles: {
    type: "article",
    title: "文章",
    description: "保存全文，也保存值得回看的上下文。",
    total: 24,
  },
  all: {
    type: "all",
    title: "全部收藏",
    description: "网站、GitHub 和文章，按收藏时间统一排列。",
    total: 242,
  },
};

const aiContextMeta = {
  sites: { file: "sites.json", count: 82, chars: "28,640" },
  repos: { file: "repos.json", count: 136, chars: "42,180" },
  articles: { file: "articles.json", count: 24, chars: "18,420" },
};

const state = {
  route: "home",
  category: "全部",
  localQuery: "",
  tag: "",
  searchType: "all",
  searchMode: "keyword",
  searchIndex: -1,
  aiSource: "articles",
  aiConfigured: false,
  aiConfig: { baseUrl: "", model: "", rememberKey: false },
  aiSearchStatus: "idle",
  aiSearchOutput: "",
  articleAiExpanded: false,
  articleAiStatus: "idle",
  articleAiOutput: "",
  articleAiPrompt: "",
  pendingAiAction: null,
  simulationTimer: null,
  returnFocus: null,
  toastTimer: null,
};

const main = document.querySelector("#main-content");
const searchOverlay = document.querySelector("#search-overlay");
const searchInput = document.querySelector("#global-search-input");
const searchResults = document.querySelector("#search-results");
const keywordSearchControls = document.querySelector("#keyword-search-controls");
const aiSearchControls = document.querySelector("#ai-search-controls");
const aiSearchContext = document.querySelector("#ai-search-context");
const filterSheet = document.querySelector("#filter-sheet");
const tagOptions = document.querySelector("#tag-options");
const tocDrawer = document.querySelector("#toc-drawer");
const mobileToc = document.querySelector("#mobile-toc");
const aiSettingsOverlay = document.querySelector("#ai-settings-overlay");
const aiSettingsForm = document.querySelector("#ai-settings-form");
const aiSettingsStatus = document.querySelector("#ai-settings-status");
const toast = document.querySelector("#toast");
const modalLayers = [searchOverlay, filterSheet, tocDrawer, aiSettingsOverlay];
const backgroundRoots = [
  document.querySelector(".skip-link"),
  document.querySelector(".site-header"),
  main,
  document.querySelector(".mobile-bottom-nav"),
].filter(Boolean);
const focusableSelector = [
  'a[href]:not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parseRoute() {
  const path = window.location.hash.replace(/^#\/?/, "");
  if (path.startsWith("article/")) return "article";
  return ["sites", "repos", "articles", "all"].includes(path) ? path : "home";
}

function renderRow(item, showType = true) {
  const external = item.href.startsWith("http");
  const sideValue = item.stars ? `<span class="row-stars">${escapeHtml(item.stars)}</span>` : "";
  return `
    <article class="collection-row" data-type="${item.type}">
      <div>
        ${showType ? `<div class="row-type"><span>${typeNames[item.type]}</span><span>·</span><time datetime="${item.date}">${item.date.slice(5)}</time></div>` : ""}
        <a class="row-link" href="${item.href}" ${external ? 'target="_blank" rel="noreferrer"' : ""} ${external ? `aria-label="打开 ${escapeHtml(item.title)}（新窗口）"` : ""}>
          <span class="row-title">${escapeHtml(item.title)}</span>
        </a>
        <p class="row-description">${escapeHtml(item.description)}</p>
        <div class="row-meta">${item.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
      </div>
      <div class="row-side">${sideValue}<span class="row-arrow" aria-hidden="true">${external ? "↗" : "→"}</span></div>
    </article>`;
}

function renderHome() {
  const recent = records.slice(0, 7);
  main.innerHTML = `
    <div class="page-shell home-layout">
      <section class="recent-feed" aria-labelledby="recent-title">
        <div class="section-heading"><h1 id="recent-title">最近收录</h1><span>2026 · 08</span></div>
        <div class="collection-list">${recent.map((item) => renderRow(item)).join("")}</div>
      </section>
    </div>`;
}

function categoryData(items) {
  const counts = items.reduce((all, item) => {
    all[item.category] = (all[item.category] || 0) + 1;
    return all;
  }, {});
  return [
    ["全部", items.length],
    ...Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN")),
  ];
}

function tagData(items) {
  const counts = items.flatMap((item) => item.tags).reduce((all, tag) => {
    all[tag] = (all[tag] || 0) + 1;
    return all;
  }, {});
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
    .map(([tag]) => tag);
}

function categoryButtons(categories) {
  return categories
    .map(
      ([name, count]) => `
        <button class="category-button" type="button" data-category="${escapeHtml(name)}" aria-pressed="${state.category === name}">
          <span>${escapeHtml(name)}</span><span>${count}</span>
        </button>`,
    )
    .join("");
}

function renderCollection() {
  const meta = routeMeta[state.route];
  const source = meta.type === "all" ? records : records.filter((item) => item.type === meta.type);
  const categories = categoryData(source);
  const tags = tagData(source).slice(0, 8);
  const categoryFiltered = state.category === "全部" ? source : source.filter((item) => item.category === state.category);
  const query = state.localQuery.trim().toLowerCase();
  const shown = categoryFiltered.filter((item) => {
    const matchesQuery = !query || [item.title, item.description, item.category, ...item.tags].join(" ").toLowerCase().includes(query);
    return matchesQuery && (!state.tag || item.tags.includes(state.tag));
  });

  main.innerHTML = `
    <div class="page-shell collection-page">
      <header class="page-heading">
        <div><h1>${meta.title}</h1><p>${meta.description}</p></div>
        <span class="item-count">${meta.total} ${meta.type === "all" ? "items" : "条"}</span>
      </header>
      <div class="collection-layout">
        <aside class="category-rail" aria-label="分类与标签">
          <div class="category-list">${categoryButtons(categories)}</div>
          <section class="rail-tags" aria-labelledby="popular-tags-title">
            <p class="rail-label" id="popular-tags-title">热门标签</p>
            <div class="tag-links">${tags.map((tag) => `<button class="tag-link" type="button" data-tag="${escapeHtml(tag)}" aria-pressed="${state.tag === tag}">${escapeHtml(tag)}</button>`).join("")}</div>
          </section>
        </aside>
        <section class="collection-main" aria-label="收藏列表">
          <div class="mobile-category-strip" aria-label="分类筛选">${categoryButtons(categories)}</div>
          <div class="local-tools">
            <label class="local-search-label">
              <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.8"></circle><path d="m16 16 4.1 4.1"></path></svg>
              <span class="sr-only">搜索当前列表</span>
              <input id="local-search" type="search" value="${escapeHtml(state.localQuery)}" placeholder="搜索当前列表…" autocomplete="off" />
            </label>
            <button class="filter-trigger ${state.tag ? "has-filter" : ""}" type="button" aria-haspopup="dialog">筛选${state.tag ? ` · ${escapeHtml(state.tag)}` : ""}</button>
          </div>
          <div class="collection-list collection-list--${meta.type}" id="visible-collection">
            ${shown.length ? shown.map((item) => renderRow(item, meta.type === "all")).join("") : `<div class="empty-state"><h2>没有找到收藏</h2><p>试试清除关键词或当前筛选。</p><button class="quiet-button" type="button" data-clear-list>清除筛选</button></div>`}
          </div>
        </section>
      </div>
    </div>`;

  tagOptions.innerHTML = tags
    .map(
      (tag) => `<label class="tag-option"><input type="radio" name="mobile-tag" value="${escapeHtml(tag)}" ${state.tag === tag ? "checked" : ""} /><span>${escapeHtml(tag)}</span></label>`,
    )
    .join("");
}

const articleToc = [
  ["why", "01 为什么需要 Skill"],
  ["boundary", "02 先定义数据边界"],
  ["workflow", "03 让工作流可验证"],
];

function tocLinks(className = "toc-nav") {
  return `<div class="${className}">${articleToc.map(([id, label]) => `<a href="#${id}" data-toc-link data-section="${id}">${label}</a>`).join("")}</div>`;
}

function articleAiMarkup() {
  return `
    <section class="article-ai" aria-labelledby="article-ai-title">
      <header class="article-ai-heading">
        <div><p class="eyebrow">Article AI</p><h2 id="article-ai-title">针对当前文章问 AI</h2></div>
        <button class="text-button article-ai-toggle" type="button" aria-expanded="${state.articleAiExpanded}" aria-controls="article-ai-body">${state.articleAiExpanded ? "折叠" : "展开"}</button>
      </header>
      <div class="article-ai-body" id="article-ai-body" ${state.articleAiExpanded ? "" : "hidden"}>
        <p class="ai-scope-note">通用问答只基于当前 Markdown 正文，不读取其他文章或收藏数据。总结只是一个快捷问题。</p>
        <button class="quiet-button article-summary-action" type="button">总结这篇文章</button>
        <form class="article-ai-form" id="article-ai-form">
          <label class="sr-only" for="article-ai-input">针对当前文章提问</label>
          <input id="article-ai-input" type="text" placeholder="针对当前 Markdown 提问…" autocomplete="off" />
          <button class="primary-button" type="submit">发送</button>
        </form>
        <div class="article-ai-answer" id="article-ai-answer" aria-live="polite"></div>
        <div class="article-ai-actions">
          <button class="text-button article-ai-regenerate" type="button" hidden>重新生成</button>
          <button class="text-button article-ai-stop" type="button" hidden>停止</button>
          <button class="text-button article-ai-clear" type="button" hidden>清空对话</button>
        </div>
        <p class="ai-context-line">完整上下文：articles/2026-08/agent-skill.md · 当前 Markdown · 3,126 字符</p>
      </div>
    </section>`;
}

function renderArticle() {
  mobileToc.innerHTML = tocLinks("toc-nav");
  main.innerHTML = `
    <div class="page-shell article-shell">
      <div class="article-toolbar">
        <a class="back-link" href="#/articles"><span aria-hidden="true">←</span> 返回文章</a>
        <div class="article-mobile-actions">
          <button class="toc-trigger" type="button" aria-haspopup="dialog">目录 <span aria-hidden="true">≡</span></button>
          <button class="icon-button article-theme-toggle theme-toggle" type="button" aria-label="切换至深色主题">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 15.2A8.5 8.5 0 0 1 8.8 4a8.5 8.5 0 1 0 11.2 11.2Z"></path></svg>
          </button>
        </div>
      </div>
      <article class="article-layout">
        <aside class="article-toc" aria-label="本文目录"><div class="article-toc-inner"><p class="eyebrow">本文目录</p>${tocLinks()}</div></aside>
        <div class="article-reading-flow">
          <header class="article-header">
            <p class="article-kicker">Agent 开发 · <time datetime="2026-08-01">2026-08-01</time></p>
            <h1>如何构建可靠的 Agent Skill</h1>
            <p class="article-deck">一份关于工作流、数据边界与验证方式的实践。Skill 不应只是更长的提示词，而应是一条可以被理解、执行和检查的路径。</p>
            <div class="article-byline"><span>Cloudflare</span><span aria-hidden="true">·</span><button class="text-button article-ai-open" type="button">问 AI</button><span aria-hidden="true">·</span><a href="https://github.com/cloudflare/skills" target="_blank" rel="noreferrer">阅读原文 ↗</a></div>
            <div class="article-tags" aria-label="文章标签"><span>AI</span><span>skill</span><span>workflow</span></div>
          </header>
          ${articleAiMarkup()}
          <div class="article-body">
            <p>一个可靠的 Skill，首先要让 Agent 知道什么时候使用它，然后才是如何使用。触发条件、输入边界、失败方式和最终产物，都应当在行动发生之前变得清楚。</p>
            <blockquote>把 Skill 当作一份可执行的工作约定：它约束判断，也给执行留下空间。</blockquote>

            <h2 id="why">为什么需要 Skill</h2>
            <p>通用模型擅长推理，但无法天然知道一个项目积累下来的惯例。Skill 把这些惯例变成按需加载的上下文：既避免每次重复解释，也不会把无关细节塞进所有任务。</p>
            <p>好的 Skill 不追求包办一切。它只保存那些跨任务稳定、对结果有决定性影响的知识，比如内容如何落盘、何时使用真实浏览器、失败后该如何降级。</p>

            <figure class="article-figure">
              <svg viewBox="0 0 920 350" role="img" aria-labelledby="figure-title figure-desc">
                <title id="figure-title">Skill 工作流示意图</title>
                <desc id="figure-desc">从用户意图经过 Skill 编排、确定性工具，最终写入本地内容库。</desc>
                <rect x="44" y="116" width="178" height="116" rx="2"></rect>
                <rect x="371" y="116" width="178" height="116" rx="2"></rect>
                <rect x="698" y="116" width="178" height="116" rx="2"></rect>
                <path d="M222 174h149M549 174h149"></path>
                <path d="m358 164 13 10-13 10M685 164l13 10-13 10"></path>
                <text x="133" y="158" text-anchor="middle" fill="currentColor" stroke="none" font-family="system-ui" font-size="15">用户意图</text>
                <text x="133" y="186" text-anchor="middle" fill="currentColor" stroke="none" font-family="system-ui" font-size="12" opacity=".62">收藏这个链接</text>
                <text x="460" y="158" text-anchor="middle" fill="currentColor" stroke="none" font-family="system-ui" font-size="15">fav Skill</text>
                <text x="460" y="186" text-anchor="middle" fill="currentColor" stroke="none" font-family="system-ui" font-size="12" opacity=".62">识别 · 编排 · 反馈</text>
                <text x="787" y="158" text-anchor="middle" fill="currentColor" stroke="none" font-family="system-ui" font-size="15">本地内容库</text>
                <text x="787" y="186" text-anchor="middle" fill="currentColor" stroke="none" font-family="system-ui" font-size="12" opacity=".62">JSON · Markdown · 图片</text>
                <text x="44" y="296" fill="currentColor" stroke="none" font-family="system-ui" font-size="11" opacity=".5">DETERMINISTIC PATH / RECOVERABLE OUTPUT</text>
              </svg>
              <figcaption>意图交给 Skill，副作用交给可检查的确定性工具。</figcaption>
            </figure>

            <h2 id="boundary">先定义数据边界</h2>
            <p>采集系统最容易失控的地方，不是抓不到内容，而是每次抓取都产生不同的结构。先明确网站、仓库和文章各自最小字段，再让抓取器围绕这份契约工作。</p>
            <ul>
              <li>网站保留标题、用途、分类和标签。</li>
              <li>仓库额外保留 stars，但它只是收藏时的快照。</li>
              <li>文章正文独立为 Markdown，元信息只在 JSON 中出现一次。</li>
            </ul>

            <h2 id="workflow">让工作流可验证</h2>
            <p>每次写入之前都应该能先运行 <code>--dry-run</code>，看到类型判断、抓取层级、候选元信息和图片清单。验证通过后再执行一次原子写入，并让 Git 保留恢复路径。</p>
            <p>真实浏览器是兜底，不是默认。只有普通请求和正文解析都失败时才升级抓取层级；遇到登录或验证码，则把控制权交还给用户。</p>

            <section class="article-notes" aria-labelledby="notes-title">
              <div class="notes-heading"><h2 id="notes-title">笔记</h2><span>通过 GitHub Issues 公开保存</span></div>
              <p class="notes-intro">这一区域在正式网站中由 Utterances 加载；下方输入仅用于交互设计演示。</p>
              <form class="notes-form" id="prototype-note-form">
                <label for="note-input">Markdown 笔记</label>
                <textarea id="note-input" placeholder="写下你的理解或行动项…"></textarea>
                <div class="notes-actions">
                  <a href="https://github.com/mewcoder/myfav/issues" target="_blank" rel="noreferrer">在 GitHub Issues 中查看 ↗</a>
                  <button class="primary-button" type="submit">提交演示</button>
                </div>
              </form>
              <article class="note-comment">
                <p class="comment-meta">mewcoder · 2026-08-06</p>
                <p>真正重要的是把 Skill 保持在编排层：抓取和写入仍然交给确定性的命令，这样失败可以定位，结果也可以重复检查。</p>
              </article>
            </section>
          </div>
        </div>
      </article>
    </div>`;
  renderArticleAiState();
}

function render() {
  state.route = parseRoute();
  state.category = "全部";
  state.localQuery = "";
  state.tag = "";
  const isArticle = state.route === "article";
  document.body.classList.toggle("is-article", isArticle);
  if (state.route === "home") renderHome();
  else if (isArticle) renderArticle();
  else renderCollection();
  updateNavigation();
  window.scrollTo({ top: 0, behavior: "auto" });
}

function updateNavigation() {
  const current = state.route === "article" ? "articles" : state.route;
  document.querySelectorAll("[data-nav-route]").forEach((link) => {
    if (link.dataset.navRoute === current) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function activeLayer() {
  return modalLayers.find((layer) => !layer.hidden);
}

function setBackgroundInert(isInert) {
  backgroundRoots.forEach((root) => {
    root.inert = isInert;
  });
}

function openLayer(layer, trigger) {
  state.returnFocus = trigger || document.activeElement;
  layer.hidden = false;
  setBackgroundInert(true);
  document.body.classList.add("is-locked");
}

function closeLayer(layer, restoreFocus = true) {
  layer.hidden = true;
  if (!activeLayer()) {
    setBackgroundInert(false);
    document.body.classList.remove("is-locked");
  }
  const target = state.returnFocus;
  state.returnFocus = null;
  if (restoreFocus) target?.focus?.();
}

function trapLayerFocus(event, layer) {
  const focusable = [...layer.querySelectorAll(focusableSelector)].filter(
    (element) => !element.closest("[hidden]"),
  );
  if (!focusable.length) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && (document.activeElement === first || !layer.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function openSearch(trigger) {
  openLayer(searchOverlay, trigger);
  state.searchIndex = -1;
  updateSearchModeUI();
  window.setTimeout(() => searchInput.focus(), 20);
}

function defaultAiSource() {
  if (state.route === "sites") return "sites";
  if (state.route === "repos") return "repos";
  return "articles";
}

function updateSearchModeUI() {
  const isAiMode = state.searchMode === "ai";
  document.querySelectorAll("[data-search-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.searchMode === state.searchMode));
  });
  keywordSearchControls.hidden = isAiMode;
  aiSearchControls.hidden = !isAiMode;
  searchInput.placeholder = isAiMode ? "向选中的完整 JSON 文件提问…" : "搜索网站、GitHub 和文章…";
  document.querySelectorAll("[data-ai-source]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.aiSource === state.aiSource));
  });
  const context = aiContextMeta[state.aiSource];
  aiSearchContext.textContent = `完整文件上下文：${context.file} · ${context.count} 条 · ${context.chars} 字符 · 不与其他 JSON 合并`;
  if (isAiMode) renderAiSearchResults();
  else renderSearchResults();
}

function renderAiSearchResults() {
  const context = aiContextMeta[state.aiSource];
  const configuredHint = state.aiConfigured ? "演示配置已就绪" : "尚未配置，提交问题后将打开 AI 设置";
  if (state.aiSearchStatus === "idle") {
    searchResults.innerHTML = `<div class="ai-answer-empty"><p>选择一个 JSON 文件并提出问题。每次只使用该文件的完整内容。</p><span>${configuredHint}</span></div>`;
    return;
  }
  const isRunning = state.aiSearchStatus === "generating";
  searchResults.innerHTML = `
    <section class="ai-answer-block" aria-label="AI 数据回答">
      <div class="ai-answer-heading"><p class="eyebrow">AI 回答${isRunning ? " · 生成中" : ""}</p>${isRunning ? '<button class="text-button ai-search-stop" type="button">停止</button>' : '<button class="text-button ai-search-regenerate" type="button">重新生成</button>'}</div>
      <p>${escapeHtml(state.aiSearchOutput || "正在读取完整文件上下文…")}</p>
      <small>本次完整上下文：${context.file} · ${context.count} 条 · ${context.chars} 字符</small>
    </section>`;
}

function clearSimulation() {
  if (state.simulationTimer) window.clearInterval(state.simulationTimer);
  state.simulationTimer = null;
}

function simulateChunks(chunks, onProgress, onDone) {
  clearSimulation();
  let index = 0;
  state.simulationTimer = window.setInterval(() => {
    onProgress(chunks[index]);
    index += 1;
    if (index >= chunks.length) {
      clearSimulation();
      onDone();
    }
  }, 360);
}

function startAiSearch() {
  const question = searchInput.value.trim();
  if (!question) {
    state.aiSearchStatus = "done";
    state.aiSearchOutput = "请先输入一个关于当前 JSON 文件的问题。";
    renderAiSearchResults();
    return;
  }
  if (!state.aiConfigured) {
    state.pendingAiAction = { kind: "search" };
    closeLayer(searchOverlay, false);
    openAiSettings(document.querySelector(".ai-settings-trigger"));
    return;
  }
  const context = aiContextMeta[state.aiSource];
  state.aiSearchStatus = "generating";
  state.aiSearchOutput = "";
  renderAiSearchResults();
  const answers = {
    sites: ["根据 sites.json，", "与效率和内容整理相关的网站包括 Linear、Raycast 与 Are.na。", "回答只引用当前文件已有记录。"],
    repos: ["根据 repos.json，", "与 Agent Skill 和正文提取相关的仓库包括 cloudflare/skills、mozilla/readability 与 kepano/defuddle。", "这些结论未使用其他收藏文件。"],
    articles: ["根据 articles.json，", "与工作流和软件设计相关的文章包括《如何构建可靠的 Agent Skill》和《Local-first software》。", "资料不足的部分不会用外部知识补全。"],
  };
  simulateChunks(
    answers[state.aiSource],
    (chunk) => {
      state.aiSearchOutput += `${state.aiSearchOutput ? " " : ""}${chunk}`;
      renderAiSearchResults();
    },
    () => {
      state.aiSearchStatus = "done";
      state.aiSearchOutput += ` 完整上下文为 ${context.file}。`;
      renderAiSearchResults();
    },
  );
}

function filteredSearchRecords() {
  const query = searchInput.value.trim().toLowerCase();
  return records.filter((item) => {
    const matchesType = state.searchType === "all" || item.type === state.searchType;
    const haystack = [item.title, item.description, item.category, ...item.tags].join(" ").toLowerCase();
    return matchesType && (!query || haystack.includes(query));
  });
}

function renderSearchResults() {
  const found = filteredSearchRecords();
  const query = searchInput.value.trim();
  state.searchIndex = Math.min(state.searchIndex, found.length - 1);
  if (!found.length) {
    searchResults.innerHTML = `<p class="search-empty">没有找到“${escapeHtml(query)}”，试试更短的关键词。</p>`;
    return;
  }
  const groups = ["article", "repo", "site"]
    .map((type) => [type, found.filter((item) => item.type === type)])
    .filter(([, items]) => items.length);
  searchResults.innerHTML = groups
    .map(
      ([type, items]) => `
        <section class="search-result-group">
          <h3>${typeNames[type]}</h3>
          ${items
            .map((item) => {
              const resultIndex = found.indexOf(item);
              const external = item.href.startsWith("http");
              return `<a class="search-result ${resultIndex === state.searchIndex ? "is-keyboard-active" : ""}" data-search-index="${resultIndex}" href="${item.href}" ${external ? 'target="_blank" rel="noreferrer"' : ""}><span><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.category)} · ${escapeHtml(item.description)}</span></span><span aria-hidden="true">${external ? "↗" : "→"}</span></a>`;
            })
            .join("")}
        </section>`,
    )
    .join("");
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  state.toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 2800);
}

function updateAiIndicators() {
  document.querySelectorAll(".ai-settings-trigger").forEach((button) => {
    button.classList.toggle("is-configured", state.aiConfigured);
    button.setAttribute("aria-label", state.aiConfigured ? "打开 AI 设置（演示配置已就绪）" : "打开 AI 设置（未配置）");
  });
}

function openAiSettings(trigger) {
  const baseUrl = aiSettingsForm.elements.baseUrl;
  const model = aiSettingsForm.elements.model;
  const rememberKey = aiSettingsForm.elements.rememberKey;
  baseUrl.value = state.aiConfig.baseUrl;
  model.value = state.aiConfig.model;
  rememberKey.checked = state.aiConfig.rememberKey;
  aiSettingsForm.elements.apiKey.value = "";
  aiSettingsForm.elements.apiKey.placeholder = state.aiConfigured ? "••••••••（演示已配置，输入可替换）" : "demo-key（请勿填写真实密钥）";
  aiSettingsStatus.textContent = state.aiConfigured ? "演示配置已就绪，不会发送网络请求" : "当前未配置";
  openLayer(aiSettingsOverlay, trigger);
  window.setTimeout(() => {
    const firstEmpty = [baseUrl, aiSettingsForm.elements.apiKey, model].find((field) => !field.value);
    firstEmpty?.focus();
  }, 20);
}

function resumePendingAi(action) {
  if (!action) return;
  if (action.kind === "search") {
    state.searchMode = "ai";
    openSearch(document.querySelector(".search-trigger"));
    window.setTimeout(startAiSearch, 40);
  } else if (action.kind === "article") {
    startArticleAi(action.prompt);
  }
}

function renderArticleAiState() {
  const body = document.querySelector("#article-ai-body");
  if (!body) return;
  const toggle = document.querySelector(".article-ai-toggle");
  const answer = document.querySelector("#article-ai-answer");
  const regenerate = document.querySelector(".article-ai-regenerate");
  const stop = document.querySelector(".article-ai-stop");
  const clear = document.querySelector(".article-ai-clear");
  body.hidden = !state.articleAiExpanded;
  toggle.setAttribute("aria-expanded", String(state.articleAiExpanded));
  toggle.textContent = state.articleAiExpanded ? "折叠" : "展开";
  const isRunning = state.articleAiStatus === "generating";
  if (state.articleAiStatus === "idle") {
    answer.innerHTML = `<div class="ai-answer-empty"><p>可针对当前文章自由提问，或使用“总结这篇文章”快捷问题。</p><span>${state.aiConfigured ? "演示配置已就绪" : "尚未配置，提交后将打开 AI 设置"}</span></div>`;
  } else {
    answer.innerHTML = `<div class="ai-answer-block"><p class="eyebrow">回答${isRunning ? " · 生成中" : ""}</p><p>${escapeHtml(state.articleAiOutput || "正在读取当前 Markdown…")}</p></div>`;
  }
  regenerate.hidden = state.articleAiStatus !== "done";
  stop.hidden = !isRunning;
  clear.hidden = state.articleAiStatus === "idle";
}

function startArticleAi(prompt) {
  state.articleAiExpanded = true;
  state.articleAiPrompt = prompt;
  if (!state.aiConfigured) {
    state.pendingAiAction = { kind: "article", prompt };
    renderArticleAiState();
    openAiSettings(document.querySelector(".article-ai-open"));
    return;
  }
  state.articleAiStatus = "generating";
  state.articleAiOutput = "";
  renderArticleAiState();
  const isSummary = prompt === "总结这篇文章";
  const chunks = isSummary
    ? ["这篇文章说明，可靠的 Skill 应当明确触发条件、输入边界与失败方式。", "要点：Skill 保持在编排层；数据结构先于抓取实现；副作用交给确定性工具；写入前先 dry-run。"]
    : ["仅根据当前 Markdown，", "文章认为 Skill 应负责理解意图与编排流程，而抓取、校验和写入应由确定性命令完成。", "正文没有提供的信息无法据此判断。"];
  simulateChunks(
    chunks,
    (chunk) => {
      state.articleAiOutput += `${state.articleAiOutput ? " " : ""}${chunk}`;
      renderArticleAiState();
    },
    () => {
      state.articleAiStatus = "done";
      renderArticleAiState();
    },
  );
}

function stopArticleAi() {
  clearSimulation();
  state.articleAiStatus = "done";
  state.articleAiOutput += `${state.articleAiOutput ? " " : ""}已停止生成（静态演示）。`;
  renderArticleAiState();
}

function rerenderCollection(focusSelector) {
  renderCollection();
  if (focusSelector) document.querySelector(focusSelector)?.focus();
}

document.addEventListener("click", (event) => {
  const searchTrigger = event.target.closest(".search-trigger");
  if (searchTrigger) openSearch(searchTrigger);

  const aiSettingsTrigger = event.target.closest(".ai-settings-trigger");
  if (aiSettingsTrigger) openAiSettings(aiSettingsTrigger);

  const searchMode = event.target.closest("[data-search-mode]");
  if (searchMode) {
    state.searchMode = searchMode.dataset.searchMode;
    if (state.searchMode === "ai") state.aiSource = defaultAiSource();
    state.searchIndex = -1;
    updateSearchModeUI();
    searchInput.focus();
  }

  const aiSource = event.target.closest("[data-ai-source]");
  if (aiSource) {
    state.aiSource = aiSource.dataset.aiSource;
    state.aiSearchStatus = "idle";
    state.aiSearchOutput = "";
    updateSearchModeUI();
  }

  if (event.target.closest(".ai-search-submit")) startAiSearch();
  if (event.target.closest(".ai-search-regenerate")) startAiSearch();
  if (event.target.closest(".ai-search-stop")) {
    clearSimulation();
    state.aiSearchStatus = "done";
    state.aiSearchOutput += `${state.aiSearchOutput ? " " : ""}已停止生成（静态演示）。`;
    renderAiSearchResults();
  }

  if (event.target.closest(".article-ai-open")) {
    state.articleAiExpanded = true;
    renderArticleAiState();
    document.querySelector("#article-ai-body")?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => document.querySelector("#article-ai-input")?.focus(), 180);
  }

  if (event.target.closest(".article-ai-toggle")) {
    state.articleAiExpanded = !state.articleAiExpanded;
    renderArticleAiState();
  }

  if (event.target.closest(".article-summary-action")) startArticleAi("总结这篇文章");
  if (event.target.closest(".article-ai-regenerate")) startArticleAi(state.articleAiPrompt || "总结这篇文章");
  if (event.target.closest(".article-ai-stop")) stopArticleAi();
  if (event.target.closest(".article-ai-clear")) {
    clearSimulation();
    state.articleAiStatus = "idle";
    state.articleAiOutput = "";
    state.articleAiPrompt = "";
    renderArticleAiState();
  }

  const themeToggle = event.target.closest(".theme-toggle");
  if (themeToggle) {
    const nextTheme = document.body.dataset.theme === "dark" ? "light" : "dark";
    document.body.dataset.theme = nextTheme;
    document.querySelectorAll(".theme-toggle").forEach((button) => {
      button.setAttribute("aria-label", nextTheme === "dark" ? "切换至浅色主题" : "切换至深色主题");
    });
    showToast(nextTheme === "dark" ? "已切换为深色主题" : "已切换为浅色主题");
  }

  if (event.target.closest("[data-close-search]")) closeLayer(searchOverlay);
  if (event.target.closest("[data-close-filter]")) closeLayer(filterSheet);
  if (event.target.closest("[data-close-toc]")) closeLayer(tocDrawer);
  if (event.target.closest("[data-close-ai-settings]")) {
    state.pendingAiAction = null;
    closeLayer(aiSettingsOverlay);
  }

  const categoryButton = event.target.closest("[data-category]");
  if (categoryButton) {
    state.category = categoryButton.dataset.category;
    rerenderCollection(`[data-category="${CSS.escape(state.category)}"]`);
  }

  const tagButton = event.target.closest("[data-tag]");
  if (tagButton) {
    state.tag = state.tag === tagButton.dataset.tag ? "" : tagButton.dataset.tag;
    rerenderCollection(`[data-tag="${CSS.escape(tagButton.dataset.tag)}"]`);
  }

  const filterTrigger = event.target.closest(".filter-trigger");
  if (filterTrigger) {
    openLayer(filterSheet, filterTrigger);
    window.setTimeout(() => tagOptions.querySelector("input")?.focus(), 20);
  }

  if (event.target.closest(".toc-trigger")) {
    openLayer(tocDrawer, event.target.closest(".toc-trigger"));
    window.setTimeout(() => mobileToc.querySelector("a")?.focus(), 20);
  }

  const tocLink = event.target.closest("[data-toc-link]");
  if (tocLink) {
    event.preventDefault();
    const section = document.getElementById(tocLink.dataset.section);
    if (!tocDrawer.hidden) closeLayer(tocDrawer);
    section?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (event.target.closest("[data-clear-list]")) {
    state.category = "全部";
    state.localQuery = "";
    state.tag = "";
    renderCollection();
  }
});

document.addEventListener("input", (event) => {
  if (event.target === searchInput) {
    state.searchIndex = -1;
    if (state.searchMode === "keyword") {
      window.clearTimeout(searchInput.debounceTimer);
      searchInput.debounceTimer = window.setTimeout(renderSearchResults, 150);
    }
  }
  if (event.target.matches("#local-search")) {
    state.localQuery = event.target.value;
    const caretPosition = event.target.selectionStart;
    renderCollection();
    const nextInput = document.querySelector("#local-search");
    nextInput.focus();
    nextInput.setSelectionRange(caretPosition, caretPosition);
  }
});

document.querySelector(".search-tabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-search-type]");
  if (!button) return;
  state.searchType = button.dataset.searchType;
  state.searchIndex = -1;
  document.querySelectorAll("[data-search-type]").forEach((tab) => tab.setAttribute("aria-pressed", String(tab === button)));
  renderSearchResults();
});

document.querySelector("#clear-filter").addEventListener("click", () => {
  state.tag = "";
  tagOptions.querySelectorAll("input").forEach((input) => {
    input.checked = false;
  });
});

document.querySelector("#apply-filter").addEventListener("click", () => {
  state.tag = tagOptions.querySelector("input:checked")?.value || "";
  closeLayer(filterSheet, false);
  renderCollection();
  document.querySelector(".filter-trigger")?.focus();
});

document.querySelector("#clear-ai-settings").addEventListener("click", () => {
  state.aiConfigured = false;
  state.aiConfig = { baseUrl: "", model: "", rememberKey: false };
  aiSettingsForm.reset();
  aiSettingsStatus.textContent = "演示配置已清除";
  updateAiIndicators();
  renderArticleAiState();
});

document.querySelector("#test-ai-settings").addEventListener("click", () => {
  const baseUrl = aiSettingsForm.elements.baseUrl.value.trim();
  const apiKey = aiSettingsForm.elements.apiKey.value.trim();
  const model = aiSettingsForm.elements.model.value.trim();
  if (!baseUrl || (!apiKey && !state.aiConfigured) || !model) {
    aiSettingsStatus.textContent = "请填写三个示例必填项；不要使用真实密钥";
    return;
  }
  aiSettingsStatus.textContent = "正在连接…（静态演示）";
  window.setTimeout(() => {
    aiSettingsStatus.textContent = "连接成功（演示），没有发送网络请求";
  }, 650);
});

document.addEventListener("submit", (event) => {
  if (event.target.matches("#ai-settings-form")) {
    event.preventDefault();
    const baseUrl = aiSettingsForm.elements.baseUrl.value.trim();
    const apiKey = aiSettingsForm.elements.apiKey.value.trim();
    const model = aiSettingsForm.elements.model.value.trim();
    if (!baseUrl || (!apiKey && !state.aiConfigured) || !model) {
      aiSettingsStatus.textContent = "请填写三个示例必填项；不要使用真实密钥";
      return;
    }
    state.aiConfigured = true;
    state.aiConfig = { baseUrl, model, rememberKey: aiSettingsForm.elements.rememberKey.checked };
    aiSettingsForm.elements.apiKey.value = "";
    const pendingAction = state.pendingAiAction;
    state.pendingAiAction = null;
    closeLayer(aiSettingsOverlay, pendingAction?.kind !== "search");
    updateAiIndicators();
    showToast("演示配置已保存，仅保存在当前页面内存");
    resumePendingAi(pendingAction);
    return;
  }
  if (event.target.matches("#article-ai-form")) {
    event.preventDefault();
    const question = event.target.querySelector("input").value.trim();
    if (!question) {
      showToast("请先输入一个关于当前文章的问题");
      return;
    }
    startArticleAi(question);
    return;
  }
  if (event.target.matches("#prototype-note-form")) {
    event.preventDefault();
    const value = event.target.querySelector("textarea").value.trim();
    showToast(value ? "设计稿演示：正式版将通过 GitHub 提交笔记" : "请先写下一点内容");
  }
});

document.addEventListener("keydown", (event) => {
  const isTyping = event.target.matches("input, textarea, [contenteditable='true']");
  const modal = activeLayer();
  if (modal && event.key === "Tab") trapLayerFocus(event, modal);
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (!modal && searchOverlay.hidden) openSearch(document.querySelector(".search-trigger"));
  }
  if (event.key === "/" && !isTyping && ["sites", "repos", "articles", "all"].includes(state.route)) {
    event.preventDefault();
    document.querySelector("#local-search")?.focus();
  }
  if (event.key === "Escape") {
    if (!aiSettingsOverlay.hidden) {
      state.pendingAiAction = null;
      closeLayer(aiSettingsOverlay);
    } else if (!searchOverlay.hidden) closeLayer(searchOverlay);
    else if (!filterSheet.hidden) closeLayer(filterSheet);
    else if (!tocDrawer.hidden) closeLayer(tocDrawer);
  }
  if (!searchOverlay.hidden && state.searchMode === "keyword" && ["ArrowDown", "ArrowUp"].includes(event.key)) {
    event.preventDefault();
    const results = filteredSearchRecords();
    if (!results.length) return;
    const direction = event.key === "ArrowDown" ? 1 : -1;
    state.searchIndex = (state.searchIndex + direction + results.length) % results.length;
    renderSearchResults();
    searchResults.querySelector(`[data-search-index="${state.searchIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }
  if (!searchOverlay.hidden && event.key === "Enter" && event.target === searchInput && state.searchIndex >= 0) {
    event.preventDefault();
    searchResults.querySelector(`[data-search-index="${state.searchIndex}"]`)?.click();
  }
  if (!searchOverlay.hidden && state.searchMode === "ai" && event.key === "Enter" && event.target === searchInput) {
    event.preventDefault();
    startAiSearch();
  }
});

window.addEventListener("hashchange", () => {
  clearSimulation();
  closeLayer(searchOverlay);
  render();
});

updateAiIndicators();
render();
