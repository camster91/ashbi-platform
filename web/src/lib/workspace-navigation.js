const detailRoutes = {
  '/projects': ['/project/', '/task/', '/review/'],
  '/clients': ['/client/'],
  '/inbox': ['/thread/'],
  '/proposals': ['/proposal/'],
  '/settings': ['/admin/', '/automations', '/notifications', '/search'],
};

export function isWorkspaceDestinationActive(item, pathname) {
  return pathname === item.href
    || (!item.exact && pathname.startsWith(`${item.href}/`))
    || (detailRoutes[item.href] || []).some(path => path.endsWith('/')
      ? pathname.startsWith(path)
      : pathname === path);
}
