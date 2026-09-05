'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

// Nested under 'Operations' in the tree below, collapsed by default.
const OPERATIONS_CHILDREN = [
  { label: 'Clients', href: '/customers' },
  { label: 'Service Providers', href: '/vendors' },
  { label: 'Workers',   href: '/workers' },
];

// Rendered pinned to the bottom of the sidebar, separate from PRIMARY_NAV —
// see the dedicated block after the scrollable nav area below.
const SETTINGS_NAV = {
  label: 'Settings', href: '/settings', icon: '⚙',
  subItems: [
    { label: 'Company', href: '/settings/company' },
  ],
};

const PRIMARY_NAV = [
  {
    // The top-level "Documents" entry itself links to /documents (the main
    // table — Doc Type is a column there covering Contract/Insurance
    // Policy/Regulation/etc., not a separate page per source type — see
    // docs/ontology-implementation-plan.md Phase 2b). A "Contracts &
    // Documents" sub-item used to duplicate that same link one level down;
    // removed as redundant — these four sub-items are its satellite views
    // instead. Insurance previously had its own sibling entry here too;
    // it's now a Source Type filter within the main table instead —
    // /documents/insurance* URLs redirect there.
    label: 'Documents', href: '/documents', icon: '◫',
    subItems: [
      { label: 'Clause Library',  href: '/documents?tab=clause-table' },
      { label: 'Playbooks',       href: '/playbooks' },
      { label: 'Document Parser', href: '/documents/parser' },
    ],
  },
];

// ── NavItem defined OUTSIDE the parent to prevent remount-on-rerender ─────────
interface NavItemProps {
  href: string;
  label: string;
  icon: string;
  collapsed: boolean;
  active: boolean;
}

function NavItem({ href, label, icon, collapsed, active }: NavItemProps) {
  return (
    <Link href={href} style={{ textDecoration: 'none', display: 'block' }}>
      <div
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: collapsed ? '10px 0' : '8px 14px',
          justifyContent: collapsed ? 'center' : 'flex-start',
          cursor: 'pointer',
          color: active ? 'var(--primary-accent)' : 'var(--text-secondary)',
          background: active ? 'rgba(124,58,237,0.1)' : 'transparent',
          borderLeft: active ? '2px solid var(--primary-accent)' : '2px solid transparent',
          borderRadius: '0 4px 4px 0',
          transition: 'color 0.15s, background 0.15s',
        }}
      >
        <span style={{ fontSize: 14, lineHeight: 1, flexShrink: 0 }}>{icon}</span>
        {!collapsed && (
          <span style={{ fontSize: '0.78rem', fontWeight: active ? 600 : 400 }}>{label}</span>
        )}
      </div>
    </Link>
  );
}

// Sub-item rendered indented under a parent nav entry
interface SubNavItemProps {
  href: string;
  label: string;
  collapsed: boolean;
  active: boolean;
  indent?: number;
}

function SubNavItem({ href, label, collapsed, active, indent = 32 }: SubNavItemProps) {
  return (
    <Link href={href} style={{ textDecoration: 'none', display: 'block' }}>
      <div
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: collapsed ? '8px 0' : `5px 14px 5px ${indent}px`,
          justifyContent: collapsed ? 'center' : 'flex-start',
          cursor: 'pointer',
          // Active color matches the purple circle in the CONS●LA logo
          // (var(--primary-accent)) instead of plain white.
          color: active ? 'var(--primary-accent)' : 'rgba(148,163,184,0.5)',
          background: 'transparent',
          transition: 'color 0.15s',
        }}
      >
        {collapsed ? (
          <span style={{ fontSize: 11, lineHeight: 1 }}>◈</span>
        ) : (
          <span style={{ fontSize: '0.76rem', fontWeight: active ? 700 : 400 }}>{label}</span>
        )}
      </div>
    </Link>
  );
}

// Chevron toggle used by every collapsible group (Operations, Contracts & Documents)
function ExpandToggle({ expanded, onToggle, label }: { expanded: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(); }}
      aria-label={expanded ? `Collapse ${label} sub-pages` : `Expand ${label} sub-pages`}
      aria-expanded={expanded}
      style={{
        position: 'absolute',
        right: 10,
        top: '50%',
        transform: 'translateY(-50%)',
        background: 'none',
        border: 'none',
        color: 'rgba(148,163,184,0.5)',
        cursor: 'pointer',
        fontSize: 10,
        padding: 4,
        lineHeight: 1,
      }}
    >
      {expanded ? '▾' : '▸'}
    </button>
  );
}

interface Props { collapsed: boolean; onToggle: () => void; }

function SidebarInner({ collapsed, onToggle }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [operationsExpanded, setOperationsExpanded] = useState(false);

  function isActive(href: string, exact = false): boolean {
    const [path, query] = href.split('?');
    if (exact ? pathname !== path : (pathname !== path && !pathname.startsWith(path + '/'))) return false;
    if (!query) return true;
    const params = new URLSearchParams(query);
    for (const [key, value] of params.entries()) {
      if (searchParams.get(key) !== value) return false;
    }
    return true;
  }

  function isNavActive(href: string): boolean {
    return isActive(href);
  }

  // A parent is only shown as "active" when none of its descendants are — the
  // most specific matching item should own the highlight, not its ancestors.
  function hasActiveDescendant(subItems?: { href: string; exact?: boolean; subItems?: { href: string; exact?: boolean }[] }[]): boolean {
    return subItems?.some(sub => isActive(sub.href, sub.exact) || hasActiveDescendant(sub.subItems)) ?? false;
  }

  return (
    <div style={{
      width: collapsed ? 56 : 220,
      flexShrink: 0,
      height: '100%',
      background: 'var(--bg-secondary)',
      borderRight: '1px solid var(--border-color)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      transition: 'width 0.2s ease',
      zIndex: 10,
    }}>
      {/* Collapse toggle */}
      <button
        onClick={onToggle}
        style={{
          height: 40,
          width: '100%',
          background: 'none',
          border: 'none',
          borderBottom: '1px solid var(--border-color)',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-end',
          paddingRight: collapsed ? 0 : 14,
          fontSize: 12,
          flexShrink: 0,
        }}
      >
        {collapsed ? '›' : '‹'}
      </button>

      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>

        {/* Home — primary entry point */}
        <NavItem
          href="/home"
          label="Compliance"
          icon="⌂"
          collapsed={collapsed}
          active={isNavActive('/home')}
        />
        <SubNavItem
          href="/legal-requirements"
          label="Legal Requirements"
          collapsed={collapsed}
          active={pathname === '/legal-requirements'}
        />
        {(() => {
          const childActive = OPERATIONS_CHILDREN.some(c => isActive(c.href));
          const showChildren = operationsExpanded || childActive;
          return (
            <div>
              <div style={{ position: 'relative' }}>
                <SubNavItem
                  href="/operations"
                  label="Operations"
                  collapsed={collapsed}
                  active={isActive('/operations') && !childActive}
                />
                {!collapsed && (
                  <ExpandToggle expanded={showChildren} onToggle={() => setOperationsExpanded(v => !v)} label="Operations" />
                )}
              </div>
              {showChildren && OPERATIONS_CHILDREN.map(child => (
                <SubNavItem
                  key={child.href}
                  href={child.href}
                  label={child.label}
                  collapsed={collapsed}
                  active={isActive(child.href)}
                  indent={46}
                />
              ))}
            </div>
          );
        })()}

        {/* Thin divider after Home */}
        <div style={{ margin: '4px 14px 4px', borderTop: '1px solid rgba(255,255,255,0.06)' }} />

        {/* Primary nav */}
        {PRIMARY_NAV.map(item => {
          return (
            <div key={item.href}>
              <NavItem
                href={item.href}
                label={item.label}
                icon={item.icon}
                collapsed={collapsed}
                active={isNavActive(item.href) && !hasActiveDescendant(item.subItems)}
              />
              {item.subItems?.map(sub => (
                <SubNavItem
                  key={sub.href}
                  href={sub.href}
                  label={sub.label}
                  collapsed={collapsed}
                  active={isActive(sub.href)}
                />
              ))}
            </div>
          );
        })}
      </div>

      {/* Settings — pinned to the bottom, separate from the scrollable nav above */}
      <div style={{ flexShrink: 0, borderTop: '1px solid var(--border-color)', padding: '4px 0' }}>
        <NavItem
          href={SETTINGS_NAV.href}
          label={SETTINGS_NAV.label}
          icon={SETTINGS_NAV.icon}
          collapsed={collapsed}
          active={isNavActive(SETTINGS_NAV.href) && !hasActiveDescendant(SETTINGS_NAV.subItems)}
        />
        {SETTINGS_NAV.subItems.map(sub => (
          <SubNavItem
            key={sub.href}
            href={sub.href}
            label={sub.label}
            collapsed={collapsed}
            active={isActive(sub.href)}
          />
        ))}
      </div>
    </div>
  );
}

export default function Sidebar(props: Props) {
  return (
    <Suspense fallback={
      <div style={{ width: props.collapsed ? 56 : 220, flexShrink: 0, height: '100%', background: 'var(--bg-secondary)', borderRight: '1px solid var(--border-color)' }} />
    }>
      <SidebarInner {...props} />
    </Suspense>
  );
}
