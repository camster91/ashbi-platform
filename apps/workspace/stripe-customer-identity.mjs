// Stripe assigns a previously unset default currency when the first invoice is
// created. Accept only that transition to this invoice's reviewed currency;
// preserve every frozen party field and every previously established currency.
export function stripeCustomerMatches(actual,expected,invoiceCurrency){
 if(!actual||!expected||actual.id!==expected.id||actual.name!==expected.name||actual.email!==expected.email)return false;
 const current=actual.currency??null;
 return current===expected.currency||expected.currency===null&&typeof invoiceCurrency==='string'&&/^[A-Z]{3}$/.test(invoiceCurrency)&&current===invoiceCurrency.toLowerCase();
}
