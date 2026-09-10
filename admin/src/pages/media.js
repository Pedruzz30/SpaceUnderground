import { confirmModal, openModal } from "../components/modal.js";
import { showToast } from "../components/toast.js";
import { describeError } from "../services/errors.js";
import { getProjects } from "../services/project-service.js";
import { removeProjectImages, resolveImageUrl, scanOrphanedAssets } from "../services/storage-service.js";
import { escapeAttribute, escapeHtml } from "../utils/html.js";

function filename(path) {
  return String(path || "").split("/").pop() || path || "asset";
}

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
      <span><strong>${escapeHtml(asset.project.name || "Untitled project")}</strong><small>${escapeHtml(asset.project.caseNumber)}</small></span>
      <span>${escapeHtml(asset.type)}</span>
      <span>${escapeHtml(filename(asset.path))}</span>
      <span>${escapeHtml(asset.position)}</span>
    </button>
  `;
}

function renderOrphan(orphan, index) {
  return `
    <div class="asset-row asset-row--orphan">
      <span class="asset-thumb"></span>
      <span><strong>${escapeHtml(orphan.path)}</strong><small>${escapeHtml(orphan.type || "asset")}</small></span>
      <span>${orphan.size ? escapeHtml(`${orphan.size} bytes`) : "—"}</span>
      <span>${orphan.createdAt ? escapeHtml(new Date(orphan.createdAt).toLocaleString()) : "—"}</span>
      <button class="button button--danger" type="button" data-delete-orphan="${index}">Delete</button>
    </div>
  `;
}

export const mediaPage = {
  title: "Media",
  breadcrumb: "CONTENT / MEDIA",
  render: () => `
    <section class="page-heading">
      <span>MEDIA LIBRARY</span>
      <h2>Project assets.</h2>
      <p>Poster and gallery files currently attached to projects.</p>
    </section>

    <section class="panel">
      <div class="toolbar">
        <label class="search-field">
          <span>Search</span>
          <input data-media-search type="search" placeholder="Search assets..." disabled>
        </label>
        <div class="segmented" role="group" aria-label="Filter media">
          <button type="button" class="is-active" data-media-filter="All" aria-pressed="true">All</button>
          <button type="button" data-media-filter="Poster" aria-pressed="false">Poster</button>
          <button type="button" data-media-filter="Gallery" aria-pressed="false">Gallery</button>
        </div>
      </div>
      <div class="asset-table" data-media-list aria-busy="true">
        <p class="empty-inline">Loading assets...</p>
      </div>
    </section>

    <section class="panel">
      <header class="panel__head">
        <div>
          <span>ORPHANED ASSETS</span>
          <h3 data-orphan-count>0</h3>
        </div>
        <button class="button" type="button" data-scan-orphans>Scan Storage</button>
      </header>
      <div class="asset-table" data-orphan-list>
        <p class="empty-inline">Run a storage scan to detect files not referenced by projects.</p>
      </div>
    </section>
  `,
  afterRender: async () => {
    const list = document.querySelector("[data-media-list]");
    const search = document.querySelector("[data-media-search]");
    const filters = [...document.querySelectorAll("[data-media-filter]")];
    const orphanList = document.querySelector("[data-orphan-list]");
    const orphanCount = document.querySelector("[data-orphan-count]");
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

    function renderList() {
      const query = search.value.trim().toLowerCase();
      const visible = assets.filter((asset) => {
        const matchesFilter = activeFilter === "All" || asset.type === activeFilter;
        const haystack = [asset.project.name, asset.project.caseNumber, asset.type, asset.path, asset.alt, asset.caption].join(" ").toLowerCase();
        return matchesFilter && haystack.includes(query);
      });

      list.innerHTML = visible.length
        ? visible.map(renderAsset).join("")
        : '<p class="empty-inline">No assets match the current filters.</p>';
      decorateThumbs(list, visible);

      list.querySelectorAll("[data-asset-index]").forEach((button) => {
        button.addEventListener("click", () => {
          const asset = visible[Number(button.dataset.assetIndex)];
          openModal({
            title: "ASSET DETAILS",
            body: `
              <dl class="detail-list">
                <div><dt>Project</dt><dd>${escapeHtml(asset.project.name)}</dd></div>
                <div><dt>Type</dt><dd>${escapeHtml(asset.type)}</dd></div>
                <div><dt>Storage path</dt><dd>${escapeHtml(asset.path)}</dd></div>
                <div><dt>Alt</dt><dd>${escapeHtml(asset.alt || "—")}</dd></div>
                <div><dt>Caption</dt><dd>${escapeHtml(asset.caption || "—")}</dd></div>
                <div><dt>Position</dt><dd>${escapeHtml(asset.position)}</dd></div>
              </dl>
            `,
            actions: [
              { label: "View Project", onClick: () => { window.location.hash = `#/projects/${asset.project.id}`; } },
              { label: "Close" },
            ],
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
      orphanList.innerHTML = '<p class="empty-inline">Scanning storage...</p>';
      try {
        orphans = await scanOrphanedAssets(assets.map((asset) => asset.path));
        orphanCount.textContent = String(orphans.length);
        orphanList.innerHTML = orphans.length ? orphans.map(renderOrphan).join("") : '<p class="empty-inline">No orphaned assets found.</p>';
      } catch (error) {
        orphanList.innerHTML = `<p class="empty-inline">${escapeHtml(describeError(error, "Unable to scan storage."))}</p>`;
      } finally {
        button.disabled = false;
      }
    });

    orphanList.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-delete-orphan]");
      if (!button) return;
      const orphan = orphans[Number(button.dataset.deleteOrphan)];
      const confirmed = await confirmModal({
        title: "DELETE ORPHANED ASSET?",
        body: `<p>This removes <code>${escapeHtml(orphan.path)}</code> from storage. It is not referenced by any loaded project.</p>`,
        confirmLabel: "Delete Asset",
      });
      if (!confirmed) return;
      await removeProjectImages([orphan.path]);
      orphans = orphans.filter((item) => item !== orphan);
      orphanCount.textContent = String(orphans.length);
      orphanList.innerHTML = orphans.length ? orphans.map(renderOrphan).join("") : '<p class="empty-inline">No orphaned assets found.</p>';
      showToast("Orphaned asset deleted.");
    });

    try {
      assets = assetRows(await getProjects());
      search.disabled = false;
      renderList();
    } catch (error) {
      list.innerHTML = `<p class="empty-inline">${escapeHtml(describeError(error, "Unable to load media."))}</p>`;
    } finally {
      list.removeAttribute("aria-busy");
    }
  },
};
