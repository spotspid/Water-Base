import { GROUPS } from '../lib/navigation'
import {
  IconBuildSheets, IconDashboard, IconExpenses, IconInventory,
  IconDocuments, IconHelp, IconJobs, IconMoney, IconOrders, IconOutstanding, IconQuotes,
  IconSchedule, IconSettings,
  IconWarranty,
} from './NavIcons'

// The nav groups with an icon on every item.
//
// The icons are attached here rather than in navigation.js so that file stays
// free of components and can be read by anything, including a plain Node
// script. They live apart from TopNav so scripts/check-nav.js can render every
// menu without also loading the account menu and its database client.
//
// Keyed by the path in navigation.js, exactly. When Build sheets moved from
// /templates to /build-sheets and Settings gained its own group, this map was
// not updated, both items got an undefined icon, and opening Stock or Setup
// crashed the page. check:nav now fails the build on any path missing here.
const ICONS = {
  '/dashboard': IconDashboard,
  '/schedule': IconSchedule,
  '/quotes': IconQuotes,
  '/jobs': IconJobs,
  '/documents': IconDocuments,
  '/inventory': IconInventory,
  '/orders': IconOrders,
  '/build-sheets': IconBuildSheets,
  '/warranty': IconWarranty,
  '/expenses': IconExpenses,
  '/pnl': IconMoney,
  '/outstanding': IconOutstanding,
  '/settings': IconSettings,
  '/help': IconHelp,
}

export const NAV_GROUPS = GROUPS.map(group => ({
  ...group,
  items: group.items.map(item => ({ ...item, Icon: ICONS[item.to] })),
}))
