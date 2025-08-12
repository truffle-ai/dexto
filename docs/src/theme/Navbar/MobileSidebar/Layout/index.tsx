import React, {version, useEffect, useRef, type ReactNode, type HTMLAttributes} from 'react';
import clsx from 'clsx';
import {useNavbarSecondaryMenu} from '@docusaurus/theme-common/internal';
import {ThemeClassNames} from '@docusaurus/theme-common';
import type {Props} from '@theme/Navbar/MobileSidebar/Layout';

// TODO Docusaurus v4: remove temporary inert workaround
//  See https://github.com/facebook/react/issues/17157
//  See https://github.com/radix-ui/themes/pull/509
function inertProps(inert: boolean): HTMLAttributes<HTMLDivElement> {
  const majorVersion = (() => {
    if (typeof version !== 'string') return undefined;
    const first = version.split('.')[0];
    const parsed = Number.parseInt(first ?? '', 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  })();

  const isBeforeReact19 = majorVersion !== undefined && majorVersion < 19;
  if (isBeforeReact19) {
    // For React <19, do not set the prop here; we'll set/remove the attribute via ref effect
    return {};
  }
  return inert ? { inert } : {};
}

function NavbarMobileSidebarPanel({
  children,
  inert,
}: {
  children: ReactNode;
  inert: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const majorVersion = (() => {
      if (typeof version !== 'string') return undefined;
      const first = version.split('.')[0];
      const parsed = Number.parseInt(first ?? '', 10);
      return Number.isNaN(parsed) ? undefined : parsed;
    })();
    const isBeforeReact19 = majorVersion !== undefined && majorVersion < 19;
    if (!isBeforeReact19) {
      return;
    }
    const node = panelRef.current;
    if (!node) {
      return;
    }
    if (inert) {
      node.setAttribute('inert', '');
    } else {
      node.removeAttribute('inert');
    }
  }, [inert]);
  return (
    <div
      ref={panelRef}
      className={clsx(
        ThemeClassNames.layout.navbar.mobileSidebar.panel,
        'navbar-sidebar__item menu',
      )}
      {...inertProps(inert)}>
      {children}
    </div>
  );
}

export default function NavbarMobileSidebarLayout({
  header,
  primaryMenu,
  secondaryMenu,
}: Props): ReactNode {
  const {shown: secondaryMenuShown} = useNavbarSecondaryMenu();
  return (
    <div
      className={clsx(
        ThemeClassNames.layout.navbar.mobileSidebar.container,
        'navbar-sidebar',
      )}>
      {header}
      <div
        className={clsx('navbar-sidebar__items', {
          'navbar-sidebar__items--show-secondary': secondaryMenuShown,
        })}>
        <NavbarMobileSidebarPanel inert={secondaryMenuShown}>
          {primaryMenu}
        </NavbarMobileSidebarPanel>
        <NavbarMobileSidebarPanel inert={!secondaryMenuShown}>
          {secondaryMenu}
        </NavbarMobileSidebarPanel>
      </div>
    </div>
  );
}
