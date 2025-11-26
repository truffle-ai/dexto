import { createRouter, createRootRoute, createRoute } from '@tanstack/react-router';
import { RootLayout } from './layouts/RootLayout';
import { HomePage } from './pages/HomePage';
import { ChatPage } from './pages/ChatPage';
import { PlaygroundPage } from './pages/PlaygroundPage';
import { NotFoundPage } from './pages/NotFoundPage';

const rootRoute = createRootRoute({
    component: RootLayout,
    notFoundComponent: NotFoundPage,
});

const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: HomePage,
});

const chatRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/chat/$sessionId',
    component: ChatPage,
});

const playgroundRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/playground',
    component: PlaygroundPage,
});

const routeTree = rootRoute.addChildren([homeRoute, chatRoute, playgroundRoute]);

export const router = createRouter({
    routeTree,
    defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router;
    }
}
