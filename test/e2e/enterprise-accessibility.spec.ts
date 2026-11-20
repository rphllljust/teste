import { expect, test } from '@playwright/test';

test('CISNE exposes one main landmark when navigating specialized Field and resource pages',async({page})=>{
 await page.goto('/');
 const main=page.getByRole('main');
 await expect(main).toHaveCount(1);
 await expect(main).toHaveAttribute('id','cisne-workspace-content');
 for(const name of ['Field Service Cockpit','Resource Planning Board']){
   await page.getByRole('navigation',{name:'Módulos empresariais'})
     .getByRole('button',{name,exact:true}).click();
   await expect(main).toHaveCount(1);
   await expect(main).toBeVisible();
   await expect(page.getByRole('region',{name:name==='Field Service Cockpit'?'Cockpit de Field Service':'Resource Planning Board'})).toBeVisible();
 }
});

test('skip link lands in the enterprise workspace and preserves keyboard focus',async({page})=>{
 await page.goto('/');
 await page.keyboard.press('Tab');
 const skip=page.getByRole('link',{name:'Ir para conteúdo principal'});
 await expect(skip).toBeFocused();
 await page.keyboard.press('Enter');
 await expect(page).toHaveURL(/#cisne-workspace-content$/);
 await expect(page.locator('#cisne-workspace-content')).toBeVisible();
});
