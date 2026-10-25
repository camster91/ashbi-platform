// CI partitions the full coordinator; the ordinary command still runs all suites.
export const browserGroups=Object.freeze({
 core:Object.freeze(['runRegressions','runTaskBoardTests','runCommentTests','runDocumentTests','runDocumentTreeTests','runTimerTests','runTimeReviewTests','runFinanceTests']),
 commerce:Object.freeze(['runCommercialTests','runProposalReviewTests','runStripeTests','runInvoiceTests','runRecordLinkTests']),
 contracts:Object.freeze(['runDashboardTests','runContractTests','runContractPdfTests','runStripeIssuanceTests'])
});
const all=Object.freeze(Object.values(browserGroups).flat());
export function selectBrowserSuites(group){
 if(group===undefined||group==='all')return all;
 if(typeof group!=='string'||!Object.hasOwn(browserGroups,group))throw Error('Unknown workspace browser group');
 return browserGroups[group];
}
