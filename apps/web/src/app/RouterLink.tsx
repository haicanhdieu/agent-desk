import { createLink } from '@tanstack/react-router';
import type { AnchorHTMLAttributes, Ref } from 'react';
import type { LinkComponent } from '@/ds';

// The `ds` link contract is an anchor with an `href` string; screens build those hrefs from route paths. This
// adapter hands the href to a TanStack Router link (client-side navigation, intent preloading, active state)
// without the screens importing the router.

function Anchor(props: AnchorHTMLAttributes<HTMLAnchorElement> & { ref?: Ref<HTMLAnchorElement> }) {
  return <a {...props} />;
}

const TanStackAnchor = createLink(Anchor);

/** Splits an in-app href into the router's `to`, `search` and `hash`. */
export function splitHref(href: string): { to: string; search: Record<string, string>; hash: string } {
  const url = new URL(href, 'http://app.invalid');
  return {
    to: url.pathname,
    search: Object.fromEntries(url.searchParams),
    hash: url.hash.replace(/^#/, ''),
  };
}

export const RouterLink: LinkComponent = ({ href, ...rest }) => {
  const { to, search, hash } = splitHref(href);
  return <TanStackAnchor {...rest} to={to} search={search} hash={hash || undefined} preload="intent" />;
};
