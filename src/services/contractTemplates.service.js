// Contract templates with placeholder substitution

const templates = {
  RETAINER: {
    title: 'Retainer Agreement',
    content: `<h1>Retainer Service Agreement</h1>

<p>This Retainer Service Agreement ("Agreement") is entered into between <strong>Ashbi Design</strong> ("Agency") and <strong>{clientName}</strong> ("Client").</p>

<h2>1. Services</h2>
<p>The Agency agrees to provide ongoing design and development services under a monthly retainer plan.</p>

<h2>2. Retainer Details</h2>
<ul>
  <li><strong>Tier:</strong> {tier}</li>
  <li><strong>Monthly Hours:</strong> {hours} hours</li>
  <li><strong>Monthly Rate:</strong> \${price}</li>
  <li><strong>Start Date:</strong> {startDate}</li>
</ul>

<h2>3. Scope of Work</h2>
<p>Services include but are not limited to: UI/UX design, web development, graphic design, and consultation. Hours are allocated on a monthly basis and do not roll over.</p>

<h2>4. Payment Terms</h2>
<p>Payment is due on the 1st of each month. Late payments may result in suspension of services after a 7-day grace period.</p>

<h2>5. Revision Policy</h2>
<p>Each deliverable includes up to 2 rounds of revisions within the allocated hours. Additional revisions will be billed at the hourly rate.</p>

<h2>6. Termination</h2>
<p>Either party may terminate this agreement with 30 days written notice. Unused hours in the final month are non-refundable.</p>

<h2>7. Confidentiality</h2>
<p>Both parties agree to maintain the confidentiality of all proprietary information shared during the course of this engagement.</p>

<p><strong>Agreed and accepted:</strong></p>
<p>Agency: Ashbi Design<br/>
Client: {clientName}<br/>
Date: {startDate}</p>`
  },

  PROJECT: {
    title: 'Project Agreement',
    content: `<h1>Project Service Agreement</h1>

<p>This Project Service Agreement ("Agreement") is entered into between <strong>Ashbi Design</strong> ("Agency") and <strong>{clientName}</strong> ("Client").</p>

<h2>1. Project Details</h2>
<ul>
  <li><strong>Project:</strong> {projectName}</li>
  <li><strong>Total Price:</strong> \${price}</li>
  <li><strong>Timeline:</strong> {timeline}</li>
</ul>

<h2>2. Deliverables</h2>
{deliverables}

<h2>3. Payment Schedule</h2>
<ul>
  <li>50% deposit upon signing</li>
  <li>25% at midpoint milestone</li>
  <li>25% upon project completion</li>
</ul>

<h2>4. Revision Policy</h2>
<p>This project includes up to 2 rounds of revisions per deliverable. Additional revisions will be billed at \$150/hour.</p>

<h2>5. Timeline</h2>
<p>The estimated timeline begins upon receipt of the deposit and all required assets from the Client. Delays caused by late client feedback may extend the timeline.</p>

<h2>6. Ownership & License</h2>
<p>Upon full payment, the Client receives full ownership of all final deliverables. The Agency retains the right to showcase the work in its portfolio.</p>

<h2>7. Termination</h2>
<p>If the Client terminates the project, payment for all completed work is due. If the Agency terminates, a pro-rated refund will be issued.</p>

<p><strong>Agreed and accepted:</strong></p>
<p>Agency: Ashbi Design<br/>
Client: {clientName}<br/>
Date: _______________</p>`
  },

  NDA: {
    title: 'Mutual Non-Disclosure Agreement',
    content: `<h1>Mutual Non-Disclosure Agreement</h1>

<p>This Mutual Non-Disclosure Agreement ("Agreement") is entered into between <strong>Ashbi Design</strong> ("Party A") and <strong>{clientName}</strong> ("Party B").</p>

<h2>1. Purpose</h2>
<p>The parties wish to explore a potential business relationship and may need to share confidential information.</p>

<h2>2. Definition of Confidential Information</h2>
<p>Confidential Information includes all non-public information disclosed by either party, whether written, oral, or visual, including but not limited to: business plans, financial data, technical specifications, designs, customer lists, and trade secrets.</p>

<h2>3. Obligations</h2>
<p>Each party agrees to:</p>
<ul>
  <li>Keep all Confidential Information strictly confidential</li>
  <li>Not disclose it to third parties without prior written consent</li>
  <li>Use it only for the purpose of evaluating the potential business relationship</li>
  <li>Take reasonable measures to protect the confidentiality of such information</li>
</ul>

<h2>4. Exclusions</h2>
<p>This Agreement does not apply to information that: (a) is publicly available, (b) was known prior to disclosure, (c) is independently developed, or (d) is required to be disclosed by law.</p>

<h2>5. Duration</h2>
<p>This Agreement remains in effect for 2 years from the date of signing.</p>

<h2>6. Return of Information</h2>
<p>Upon request or termination of discussions, each party will return or destroy all Confidential Information received.</p>

<p><strong>Agreed and accepted:</strong></p>
<p>Party A: Ashbi Design<br/>
Party B: {clientName}<br/>
Date: _______________</p>`
  }
};

export function getContractTemplate(templateType) {
  return templates[templateType] || null;
}

export function renderTemplate(templateType, variables = {}) {
  const template = templates[templateType];
  if (!template) return null;

  let content = template.content;
  for (const [key, value] of Object.entries(variables)) {
    content = content.replace(new RegExp(`\\{${key}\\}`, 'g'), value || '');
  }

  return {
    title: template.title,
    content
  };
}
