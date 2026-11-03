import { Outlet, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { Room } from './components/Room';
import { Landing } from './routes/Landing';
import { NotFound } from './routes/NotFound';

const rootRoute = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: NotFound,
});

const landingRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: Landing });

const roomRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/r/$code',
  component: function RoomPage() {
    const { code } = roomRoute.useParams();
    return <Room code={code.toUpperCase()} />;
  },
});

const routeTree = rootRoute.addChildren([landingRoute, roomRoute]);

export const router = createRouter({ routeTree, defaultPreload: false, scrollRestoration: true });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
