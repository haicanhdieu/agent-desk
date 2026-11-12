import { createRootRouteWithContext } from '@tanstack/react-router';
import { rootRouteOptions, type RouterContext } from '../root';

export const Route = createRootRouteWithContext<RouterContext>()({
  ...rootRouteOptions,
});
