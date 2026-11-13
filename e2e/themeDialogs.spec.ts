import { expect, test, type Locator } from '@playwright/test';
import { contrastRatio } from './contrast';

async function expectReadableText(locator: Locator, surface: Locator = locator) {
  await expect(locator).toBeVisible();
  const foreground = await locator.evaluate(element => getComputedStyle(element).color);
  const background = await surface.evaluate(element => getComputedStyle(element).backgroundColor);
  expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
}

for (const [theme, appearanceLabel, background] of [
  ['light', 'Light Soft white', 'rgb(246, 248, 251)'],
  ['oled', 'OLED True black', 'rgb(5, 5, 6)'],
]) {
  test(`Find/Change and Collaboration remain readable in ${theme} with minimal buttons`, async ({ page }) => {
    await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
    await page.goto('/');
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    const appearance = page.getByRole('dialog', { name: 'Appearance' });
    await appearance.getByRole('button', { name: appearanceLabel }).click();
    await appearance.getByRole('button', { name: /Minimal Quiet controls/ }).click();
    await appearance.getByRole('button', { name: 'Close Appearance' }).click();

    const findButton = page.getByTitle('Find / Change (GREP) (Ctrl+F)');
    await findButton.click();
    const find = page.getByRole('dialog', { name: 'Find / Change' });
    await expect(find).toHaveCSS('background-color', background);
    await expectReadableText(find.getByRole('heading'), find);
    const search = find.getByRole('textbox', { name: 'Find what' });
    await expect(search).toBeFocused();
    await expectReadableText(search);
    await expectReadableText(find.getByRole('combobox', { name: 'Find paragraph style' }));
    await expectReadableText(find.getByRole('combobox', { name: 'Find character style' }));
    await expectReadableText(find.getByRole('button', { name: 'Change All' }));
    await search.fill('no-match-theme-regression');
    await search.press('Enter');
    const result = find.getByRole('status');
    await expect(result).toHaveText('No matching text found in specified scope.');
    await expectReadableText(result);
    await search.press('Escape');
    await expect(find).toBeHidden();
    await expect(findButton).toBeFocused();

    const collabButton = page.getByTitle('Live Peer-to-Peer Real-Time Collaboration');
    await collabButton.click();
    const collaboration = page.getByRole('dialog', { name: 'Real-Time P2P WebRTC Collaboration' });
    await expect(collaboration).toHaveCSS('background-color', background);
    await expectReadableText(collaboration.getByRole('heading'), collaboration);
    await expectReadableText(collaboration.getByRole('textbox', { name: 'Session Room ID' }));
    await expectReadableText(collaboration.getByRole('textbox', { name: 'Your Designer Handle' }));
    const password = collaboration.getByLabel('Room Password');
    await password.fill('layout-review');
    await collaboration.getByRole('button', { name: 'Show password' }).click();
    await expect(password).toHaveAttribute('type', 'text');
    await expectReadableText(password);
    const copy = collaboration.getByRole('button', { name: 'Copy Secure Share Link' });
    await expect(copy).toBeEnabled();
    await expectReadableText(copy, collaboration);
    await expectReadableText(collaboration.getByRole('button', { name: 'Connect Session' }));
    await expectReadableText(collaboration.getByRole('button', { name: 'Close', exact: true }), collaboration);
    await collaboration.getByRole('button', { name: 'Close', exact: true }).press('Escape');
    await expect(collaboration).toBeHidden();
    await expect(collabButton).toBeFocused();
  });
}
