function normalized(value) {
  return String(value ?? '').trim().toLowerCase();
}

const GENERIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
  'icloud.com', 'aol.com', 'live.com', 'me.com', 'proton.me', 'protonmail.com',
]);

function safeClientDomain(value) {
  const domain = normalized(value);
  return domain && !GENERIC_EMAIL_DOMAINS.has(domain) ? domain : null;
}

function sourceRow(row, index) {
  return {
    sourceRow: index + 2,
    name: String(row.Name ?? '').trim(),
    email: normalized(row.Email),
    domain: normalized(row.Domain).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, ''),
    phone: String(row['Phone Number'] ?? '').trim(),
  };
}

function addToSetMap(map, key, value) {
  if (!key) return;
  map.set(key, new Set([...(map.get(key) ?? []), value]));
}

function targetName(row) {
  return String(row?.client_or_company_name ?? '').trim();
}

function differingConnectionFields(rows) {
  const fields = ['name', 'domain', 'phone'];
  return fields.filter(field => new Set(rows.map(row => normalized(row[field])).filter(Boolean)).size > 1);
}

export function mapBonsaiConnections({ connectionRows, projectRows, invoiceRows, shouldSkipClient = () => false }) {
  if (!Array.isArray(connectionRows) || !Array.isArray(projectRows) || !Array.isArray(invoiceRows)) {
    throw new TypeError('Connection, project, and invoice source rows must be arrays');
  }

  const targets = new Map();
  const registerTarget = (name) => {
    const key = normalized(name);
    if (!key || shouldSkipClient(name)) return null;
    if (!targets.has(key)) targets.set(key, { key, name: String(name).trim(), invoiceEmails: new Set() });
    return targets.get(key);
  };
  for (const project of projectRows) registerTarget(targetName(project));
  for (const invoice of invoiceRows) {
    const target = registerTarget(targetName(invoice));
    const email = normalized(invoice.client_email);
    if (target && email) target.invoiceEmails.add(email);
  }

  const targetKeysByEmail = new Map();
  for (const target of targets.values()) {
    for (const email of target.invoiceEmails) addToSetMap(targetKeysByEmail, email, target.key);
  }

  const findings = [];
  const mappedByTarget = new Map();
  let ignoredConnections = 0;
  connectionRows.map(sourceRow).forEach((connection) => {
    const candidates = new Set();
    const nameKey = normalized(connection.name);
    if (targets.has(nameKey)) candidates.add(nameKey);
    for (const candidate of targetKeysByEmail.get(connection.email) ?? []) candidates.add(candidate);
    if (candidates.size === 0) {
      ignoredConnections += 1;
      return;
    }
    if (candidates.size > 1) {
      findings.push({
        code: 'CONNECTION_TARGET_CONFLICT', sourceRow: connection.sourceRow,
        candidateClients: [...candidates].map(key => targets.get(key).name).sort(),
      });
      return;
    }
    const targetKey = [...candidates][0];
    mappedByTarget.set(targetKey, [...(mappedByTarget.get(targetKey) ?? []), connection]);
  });

  const clients = [];
  for (const target of targets.values()) {
    const connections = mappedByTarget.get(target.key) ?? [];
    const byEmail = new Map();
    for (const connection of connections.filter(item => item.email)) {
      byEmail.set(connection.email, [...(byEmail.get(connection.email) ?? []), connection]);
    }
    const usableConnections = [];
    for (const [email, rows] of byEmail) {
      const differences = differingConnectionFields(rows);
      if (differences.length > 0) {
        findings.push({
          code: 'DUPLICATE_CONNECTION_EMAIL_CONFLICT', clientName: target.name,
          sourceRows: rows.map(row => row.sourceRow), fields: differences,
        });
        continue;
      }
      usableConnections.push({ ...rows[0], email });
    }
    const profileOnly = connections.filter(connection => !connection.email && normalized(connection.name) === target.key);
    if (profileOnly.length > 1 && differingConnectionFields(profileOnly).length > 0) {
      findings.push({
        code: 'DUPLICATE_CONNECTION_PROFILE_CONFLICT', clientName: target.name,
        sourceRows: profileOnly.map(row => row.sourceRow),
      });
    }
    const profiles = [...usableConnections, ...(profileOnly.length > 0 ? [profileOnly[0]] : [])];
    const invoiceMatches = usableConnections.filter(connection => target.invoiceEmails.has(connection.email));
    const nameMatches = profiles.filter(connection => normalized(connection.name) === target.key);
    let primary = null;
    if (invoiceMatches.length === 1) primary = invoiceMatches[0];
    else if (invoiceMatches.length > 1) {
      findings.push({
        code: 'AMBIGUOUS_PRIMARY_CONNECTION', clientName: target.name,
        sourceRows: invoiceMatches.map(row => row.sourceRow), reason: 'multiple_invoice_emails',
      });
    } else if (nameMatches.length === 1) primary = nameMatches[0];
    else if (nameMatches.length > 1) {
      findings.push({
        code: 'AMBIGUOUS_PRIMARY_CONNECTION', clientName: target.name,
        sourceRows: nameMatches.map(row => row.sourceRow), reason: 'multiple_exact_names',
      });
    } else if (usableConnections.length === 1) primary = usableConnections[0];

    clients.push({
      name: target.name,
      invoiceEmails: [...target.invoiceEmails].sort(),
      domain: safeClientDomain(primary?.domain),
      primaryConnection: primary,
      connections: usableConnections.sort((left, right) => left.sourceRow - right.sourceRow),
    });
  }

  const clientsByDomain = new Map();
  for (const client of clients.filter(item => item.domain)) {
    clientsByDomain.set(client.domain, [...(clientsByDomain.get(client.domain) ?? []), client]);
  }
  for (const [domain, domainClients] of clientsByDomain) {
    if (domainClients.length > 1) {
      findings.push({
        code: 'CONNECTION_DOMAIN_CONFLICT', domain,
        clientNames: domainClients.map(client => client.name).sort(),
      });
      for (const client of domainClients) client.domain = null;
    }
  }

  return {
    clients: clients.sort((left, right) => left.name.localeCompare(right.name)),
    findings,
    summary: {
      sourceConnections: connectionRows.length,
      operationalClients: targets.size,
      mappedConnections: [...mappedByTarget.values()].reduce((sum, rows) => sum + rows.length, 0),
      ignoredConnections,
      clientsWithPrimaryConnection: clients.filter(client => client.primaryConnection).length,
    },
  };
}
