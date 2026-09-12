import { confirmModal, openModal } from "../components/modal.js";
import { showToast } from "../components/toast.js";
import { describeError } from "../services/errors.js";
import { getProjects } from "../services/project-service.js";
import { removeProjectImages, resolveImageUrl, scanOrphanedAssets } from "../services/storage-service.js";
import { t } from "../i18n/index.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";

function filename(path) {
  return String(path || "").split("/").pop() || path || t("media.asset");
}

// "Poster" and "Gallery" are the stored asset kinds; only the cell label reads
// differently per locale.
function assetRows(projects) {
  return projects.flatMap((project) => {
    const rows = [];
    if (project.poster) rows.push({ project, type: "Poster", path: project.poster, alt: `${project.name} poster`, caption: "", position: "—" });
    (project.gallery || []).forEach((image, index) => rows.push({
      project,
      type: "Gallery",
      path: image.path,
      alt: image.alt || "",
      caption: image.caption || "",
      position: String(index + 1).padStart(2, "0"),
    }));
    return rows;
  });
}

function renderAsset(asset, index) {
  return `
    <button class="asset-row" type="button" data-asset-index="${index}">
      <span class="asset-thumb" data-thumb="${index}"></span>
      <span><strong>${escapeHtml(asset.project.name || t("media.untitledProject"))}</strong><small>${escapeHtml(asset.project.caseNumber)}</small></span>
      <span data-i18n="media.types.${asset.type}">${escapeHtml(t(`media.types.${asset.type}`))}</span>
      <span>${escapeHtml(filename(asset.path))}</span>
      <span>${escapeHtml(asset.position)}</span>
    </button>
  `;
}

function mediaStats(assets) {
  const posters = assets.filter((asset) => asset.type === "Poster").length;
  const galleries = assets.filter((asset) => asset.type === "Gallery").length;
  const storage = assets.filter((asset) => !/^(https?:|data:|blob:|\/|\.{1,2}\/)/i.test(asset.path)).length;
  return [
    { labelKey: "media.statTotal", value: assets.length, hintKey: "media.statTotalHint" },
    { labelKey: "media.statPosters", value: posters, hintKey: "media.statPostersHint" },
    { labelKey: "media.statGallery", value: galleries, hintKey: "media.statGalleryHint" },
    { labelKey: "media.statStorage", value: storage, hintKey: "media.statStorageHint" },
  ];
}

function statCard(stat) {
  return `
    <article class="stat-card">
      <span data-i18n="${stat.labelKey}">${escapeHtml(t(stat.labelKey))}</span>
      <strong>${escapeHtml(String(stat.value))}</strong>
      <p data-i18n="${stat.hintKey}">${escapeHtml(t(stat.hintKey))}</p>
    </article>
  `;
}

function renderOrphan(orphan, index) {
  return `
    <div class="asset-row asset-row--orphan">
      <span class="asset-thumb"></span>
      <span><strong>${escapeHtml(orphan.path)}</strong><small>${escapeHtml(orphan.type || t("media.asset"))}</small></span>
      <span>${orphan.size ? escapeHtml(t("media.bytes", { size: orphan.size })) : "—"}</span>
      <span>${orphan.createdAt ? escapeHtml(new Date(orphan.createdAt).toLocaleString(document.documentElement.lang || undefined)) : "—"}</span>
      <button class="button button--danger" type="button" data-delete-orphan="${index}" data-i18n="common.delete">${t("common.delete")}</button>
    </div>
  `;
}

export const mediaPage = {
  title: () => t("media.title"),
  breadcrumb: () => t("media.breadcrumb"),
  render: () => `
    <section class="page-heading">
      <span data-i18n="media.eyebrow">${t("media.eyebrow")}</span>
      <h2 data-i18n="media.heading">${t("media.heading")}</h2>
      <p data-i18n="media.intro">${t("media.intro")}</p>
    </section>

    <div class="stats-grid stats-grid--four" data-media-stats></div>

    <section class="panel">
      <div class="toolbar">
        <label class="search-field">
          <span data-i18n="media.search">${t("media.search")}</span>
          <input data-media-search type="search" placeholder="${t("media.searchPlaceholder")}" data-i18n-placeholder="media.searchPlaceholder" disabled>
        </label>
        <div class="segmented" role="group" aria-label="${t("media.filterMedia")}" data-i18n-aria-label="media.filterMedia">
          <button type="button" class="is-active" data-media-filter="All" aria-pressed="true" data-i18n="media.types.All">${t("media.types.All")}</button>
          <button type="button" data-media-filter="Poster" aria-pressed="false" data-i18n="media.types.Poster">${t("media.types.Poster")}</button>
          <button type="button" data-media-filter="Gallery" aria-pressed="false" data-i18n="media.types.Gallery">${t("media.types.Gallery")}</button>
        </div>
      </div>
      <div class="asset-table" data-media-list aria-busy="true">
        <p class="empty-inline" data-i18n="media.loading">${t("media.loading")}</p>
      </div>
    </section>

    <section class="panel">
      <header class="panel__head">
        <div>
          <span data-i18n="media.orphanedAssets">${t("media.orphanedAssets")}</span>
          <h3 data-orphan-count>0</h3>
        </div>
        <button class="button" type="button" data-scan-orphans data-i18n="media.scanStorage">${t("media.scanStorage")}</button>
      </header>
      <div class="asset-table" data-orphan-list>
        <p class="empty-inline" data-i18n="media.scanHint">${t("media.scanHint")}</p>
      </div>
    </section>
  `,
  afterRender: async () => {
    const list = document.querySelector("[data-media-list]");
    const search = document.querySelector("[data-media-search]");
    const filters = [...document.querySelectorAll("[data-media-filter]")];
    const orphanList = document.querySelector("[data-orphan-list]");
    const orphanCount = document.querySelector("[data-orphan-count]");
    const statsRoot = document.querySelector("[data-media-stats]");
    let assets = [];
    let activeFilter = "All";
    let orphans = [];

    async function decorateThumbs(root, rows) {
      await Promise.all(rows.map(async (asset, index) => {
        const thumb = root.querySelector(`[data-thumb="${index}"]`);
        const src = await resolveImageUrl(asset.path);
        if (thumb && src) thumb.innerHTML = `<img src="${escapeAttribute(src)}" alt="">`;
      }));
    }

    // Every localized cell on this screen carries a data-i18n key, so a locale
    // change is handled by applyStaticTranslations() without re-rendering the
    // list. That matters here: re-rendering would re-sign every storage URL.
    function renderList() {
      const query = search.value.trim().toLowerCase();
      const visible = assets.filter((asset) => {
        const matchesFilter = activeFilter === "All" || asset.type === activeFilter;
        const haystack = [asset.project.name, asset.project.caseNumber, asset.type, asset.path, asset.alt, asset.caption].join(" ").toLowerCase();
        return matchesFilter && haystack.includes(query);
      });

      list.innerHTML = visible.length
        ? visible.map(renderAsset).join("")
        : `<p class="empty-inline" data-i18n="media.noMatch">${t("media.noMatch")}</p>`;
      decorateThumbs(list, visible);

      list.querySelectorAll("[data-asset-index]").forEach((button) => {
        button.addEventListener("click", () => {
          const asset = visible[Number(button.dataset.assetIndex)];
          openModal({
            title: t("media.assetDetails"),
            body: `
              <div class="asset-detail-preview" data-modal-thumb></div>
              <dl class="detail-list">
                <div><dt data-i18n="media.project">${t("media.project")}</dt><dd>${escapeHtml(asset.project.name)}</dd></div>
                <div><dt data-i18n="media.case">${t("media.case")}</dt><dd>${escapeHtml(asset.project.caseNumber)}</dd></div>
                <div><dt data-i18n="media.type">${t("media.type")}</dt><dd>${escapeHtml(t(`media.types.${asset.type}`))}</dd></div>
                <div><dt data-i18n="media.storagePath">${t("media.storagePath")}</dt><dd>${escapeHtml(asset.path)}</dd></div>
                <div><dt data-i18n="media.alt">${t("media.alt")}</dt><dd>${escapeHtml(asset.alt || "—")}</dd></div>
                <div><dt data-i18n="media.caption">${t("media.caption")}</dt><dd>${escapeHtml(asset.caption || "—")}</dd></div>
                <div><dt data-i18n="media.position">${t("media.position")}</dt><dd>${escapeHtml(asset.position)}</dd></div>
              </dl>
            `,
            actions: [
              { label: t("media.viewProject"), onSelect: () => { window.location.hash = `#/projects/${asset.project.id}`; } },
              { label: t("common.close") },
            ],
          });
          resolveImageUrl(asset.path).then((src) => {
            const preview = document.querySelector("[data-modal-thumb]");
            if (preview && src) preview.innerHTML = `<img src="${escapeAttribute(src)}" alt="">`;
          });
        });
      });
    }

    filters.forEach((button) => {
      button.addEventListener("click", () => {
        activeFilter = button.dataset.mediaFilter;
        filters.forEach((item) => {
          const active = item === button;
          item.classList.toggle("is-active", active);
          item.setAttribute("aria-pressed", String(active));
        });
        renderList();
      });
    });

    search.addEventListener("input", renderList);

    document.querySelector("[data-scan-orphans]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      orphanList.innerHTML = `<p class="empty-inline" data-i18n="media.scanning">${t("media.scanning")}</p>`;
      try {
        orphans = await scanOrphanedAssets(assets.map((asset) => asset.path));
        orphanCount.textContent = String(orphans.length);
        orphanList.innerHTML = orphans.length
          ? orphans.map(renderOrphan).join("")
          : `<p class="empty-inline" data-i18n="media.noOrphans">${t("media.noOrphans")}</p>`;
      } catch (error) {
        orphanList.innerHTML = `<p class="empty-inline">${escapeHtml(describeError(error, t("media.scanError")))}</p>`;
      } finally {
        button.disabled = false;
      }
    });

    orphanList.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-delete-orphan]");
      if (!button) return;
      const orphan = orphans[Number(button.dataset.deleteOrphan)];
      const confirmed = await confirmModal({
        title: t("media.deleteOrphanTitle"),
        // The path is escaped before it reaches the <code> element in the copy.
        body: `<p>${t("media.deleteOrphanBody", { path: escapeHtml(orphan.path) })}</p>`,
        confirmLabel: t("media.deleteAsset"),
      });
      if (!confirmed) return;
      await removeProjectImages([orphan.path]);
      orphans = orphans.filter((item) => item !== orphan);
      orphanCount.textContent = String(orphans.length);
      orphanList.innerHTML = orphans.length
        ? orphans.map(renderOrphan).join("")
        : `<p class="empty-inline" data-i18n="media.noOrphans">${t("media.noOrphans")}</p>`;
      showToast(t("media.orphanDeleted"));
    });

    try {
      assets = assetRows(await getProjects());
      statsRoot.innerHTML = mediaStats(assets).map(statCard).join("");
      search.disabled = false;
      renderList();
    } catch (error) {
      list.innerHTML = `<p class="empty-inline">${escapeHtml(describeError(error, t("media.loadError")))}</p>`;
    } finally {
      list.removeAttribute("aria-busy");
    }
  },
};
