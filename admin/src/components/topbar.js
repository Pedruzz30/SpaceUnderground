export function topbar({ title, breadcrumb }) {
  return `
    <header class="topbar">
      <button class="topbar__menu" type="button" data-menu-toggle aria-controls="admin-sidebar" aria-expanded="false">
        <span></span>
        <span></span>
        <span class="visually-hidden">Abrir menu</span>
      </button>
      <div>
        <p>${breadcrumb}</p>
        <h1>${title}</h1>
      </div>
      <div class="topbar__account">
        <div class="topbar__user" aria-label="Administrador mockado">
          <span aria-hidden="true"></span>
          <strong>Pedro</strong>
          <small>MOCK USER</small>
        </div>
        <button class="button topbar__logout" type="button" data-logout>Logout</button>
      </div>
    </header>
  `;
}
