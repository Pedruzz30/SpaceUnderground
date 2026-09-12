// Callers pass labelKey/detailKey so the card re-labels itself on a locale
// change without the page having to re-render (and lose) its own state.
export function statCard({ label, value, detail, labelKey, detailKey }) {
  const labelAttr = labelKey ? ` data-i18n="${labelKey}"` : "";
  const detailAttr = detailKey ? ` data-i18n="${detailKey}"` : "";
  return `
    <article class="stat-card">
      <span${labelAttr}>${label}</span>
      <strong>${value}</strong>
      <p${detailAttr}>${detail}</p>
    </article>
  `;
}
