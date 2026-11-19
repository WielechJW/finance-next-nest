import { login } from './actions.js';
import { API_URL, FRONTEND_URL, test, expect } from './fixtures.js';

test('shows recent real transactions and keeps the wallet shortcuts usable on desktop and mobile', async ({
  page,
  accounts,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Twój portfel w jednym miejscu' }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('home-desktop.png'),
  });

  const account = await accounts.register();
  await login(page, account);
  const recent = page.getByRole('region', { name: 'Ostatnie transakcje' });
  await expect(
    recent.getByText('Brak transakcji', { exact: true }),
  ).toBeVisible();
  for (const [type, title, amount, occurredOn] of [
    ['INCOME', 'Wynagrodzenie', '6200.00', '2026-11-02'],
    ['EXPENSE', 'Zakupy spożywcze', '154.90', '2026-11-16'],
    ['EXPENSE', 'Bilet miesięczny', '110.00', '2026-11-18'],
  ]) {
    const categories = await page.request.get(
      API_URL + '/categories?type=' + type,
    );
    const [category] = (await categories.json()) as { id: string }[];
    const response = await page.request.post(API_URL + '/transactions', {
      headers: { Origin: FRONTEND_URL },
      data: { type, title, amount, occurredOn, categoryId: category!.id },
    });
    expect(response.status()).toBe(201);
  }
  await page.reload();
  await expect(recent.getByRole('listitem')).toHaveCount(3);
  await expect(recent.getByRole('listitem').first()).toContainText(
    'Bilet miesięczny',
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    animations: 'disabled',
    path: testInfo.outputPath('overview-desktop.png'),
  });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByRole('link', { name: 'Dodaj transakcję', exact: true }),
    ).toBeVisible();
    if (width === 390)
      await page.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath('overview-mobile.png'),
      });
  }
  await page
    .getByRole('link', { name: 'Dodaj transakcję', exact: true })
    .click();
  await expect(page).toHaveURL(/transactions#transaction-form-heading$/);
  await expect(
    page.getByRole('heading', { name: 'Nowa transakcja', exact: true }),
  ).toBeInViewport();
  await page.getByRole('link', { name: 'Portfel', exact: true }).click();
  await recent.getByRole('link', { name: 'Pełna historia' }).click();
  await expect(page).toHaveURL(/transactions#history-heading$/);
  await expect(
    page.getByRole('heading', { name: 'Historia transakcji', exact: true }),
  ).toBeInViewport();
});
