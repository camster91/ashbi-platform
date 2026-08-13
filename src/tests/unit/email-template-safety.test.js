import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceVariables } from '../../services/email.service.js';

test('email template variables are HTML-escaped in text and attribute contexts', () => {
  const rendered = replaceVariables(
    '<p>Hello {{clientName}}</p><a href="{{payLink}}">Pay</a>',
    {
      clientName: '<img src=x onerror=alert(1)> & "Avery"',
      payLink: 'https://hub.ashbi.ca/pay?ref="invoice"&next=<portal>',
    },
  );

  assert.equal(
    rendered,
    '<p>Hello &lt;img src=x onerror=alert(1)&gt; &amp; &quot;Avery&quot;</p><a href="https://hub.ashbi.ca/pay?ref=&quot;invoice&quot;&amp;next=&lt;portal&gt;">Pay</a>',
  );
});

test('email template variables leave unknown tokens visible for template review', () => {
  assert.equal(replaceVariables('Hello {{unknown}}', {}), 'Hello {{unknown}}');
});
