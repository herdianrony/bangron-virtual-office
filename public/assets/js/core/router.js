// Server mengirim index.html untuk path UI ini (appRoutes di src/app.js),
// tetapi Router hanya membaca location.hash dan default ke #/office — jadi
// membuka /login langsung menampilkan Office. Petakan path URL ke hash route.
const PATH_ROUTES = {
  '/office': '#/office',
  '/dashboard': '#/dashboard',
  '/agents': '#/agents',
  '/tasks': '#/tasks',
  '/projects': '#/projects',
  '/activities': '#/activities',
  '/approvals': '#/approvals',
  '/settings': '#/settings',
  '/login': '#/login'
};

export class Router {
  constructor(routes, defaultRoute = '#/office') {
    this.routes = routes;
    this.defaultRoute = defaultRoute;
    this.currentView = null;

    window.addEventListener('hashchange', () => this.handleRoute());
  }

  init() {
    if (window.location.hash) {
      this.handleRoute();
      return;
    }
    window.location.hash = PATH_ROUTES[window.location.pathname] || this.defaultRoute;
  }

  handleRoute() {
    const hash = window.location.hash || this.defaultRoute;
    const path = hash.split('?')[0];

    const routeHandler = this.routes[path] || this.routes[this.defaultRoute];
    if (routeHandler) {
      // Update nav link active states
      document.querySelectorAll('.nav-link').forEach((link) => {
        if (link.getAttribute('href') === path) {
          link.classList.add('active');
        } else {
          link.classList.remove('active');
        }
      });

      routeHandler();
    }
  }

  navigate(path) {
    window.location.hash = path;
  }
}

export default Router;
