import { createContext, useContext, type AnchorHTMLAttributes, type ComponentType, type ReactNode } from 'react';

export type LinkComponent = ComponentType<AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }>;

const PlainLink: LinkComponent = ({ href, children, ...rest }) => (
  <a href={href} {...rest}>
    {children}
  </a>
);

const LinkContext = createContext<LinkComponent>(PlainLink);

/** Supplies the component that renders in-app links (the app passes a router link; the default is a plain anchor). */
export function LinkProvider({ component, children }: { component: LinkComponent; children: ReactNode }) {
  return <LinkContext.Provider value={component}>{children}</LinkContext.Provider>;
}

export function useLink(): LinkComponent {
  return useContext(LinkContext);
}

/** Absolute URLs (https:, mailto:, //host) leave the app and stay plain anchors. */
const isExternal = (href: string) => /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(href);

/** Renders an in-app link through the provider and an external link as a plain anchor. */
export const AppLink: LinkComponent = (props) => {
  if (isExternal(props.href)) return <PlainLink {...props} />;
  return <LinkContext.Consumer>{(Link) => <Link {...props} />}</LinkContext.Consumer>;
};
