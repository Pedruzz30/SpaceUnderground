export function statCard({ label, value, detail }) {
  return `
    <article class="stat-card">
      <span>${label}</span>
      <strong>${value}</strong>
      <p>${detail}</p>
    </article>
  `;
}
