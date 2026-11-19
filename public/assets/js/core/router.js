export class Router {
  constructor(routes, defaultRoute = '#/office') {
    this.routes = routes;
    this.defaultRoute = defaultRoute;
    this.currentView = null;

    window.addEventListener('hashchange', () => this.handleRoute());
  }

  init() {
    if (!window.location.hash) {
      window.location.hash = this.defaultRoute;
    } else {
      this.handleRoute();
    }
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
