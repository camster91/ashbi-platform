// Exercise contextual creation through the same controls a keyboard user sees.
export async function openCreate(page,kind){
 await page.getByRole('button',{name:'Add '+kind,exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Add '+kind,exact:true});
 await dialog.waitFor();return dialog;
}
export async function closeCreate(page){
 const dialog=page.locator('dialog.record-dialog');
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await dialog.waitFor({state:'detached'});
}
export async function writeDraft(page,kind,title){
 const dialog=await openCreate(page,kind);await dialog.getByLabel('Name',{exact:true}).fill(title);await closeCreate(page);
}
export async function draftTitle(page,kind){
 const dialog=await openCreate(page,kind),title=await dialog.getByLabel('Name',{exact:true}).inputValue();await closeCreate(page);return title;
}

export async function openRecordMenu(page,title){
 const summary=page.getByLabel('More actions for '+title,{exact:true});
 if(!await summary.evaluate(e=>e.parentElement.open))await summary.click();
}
