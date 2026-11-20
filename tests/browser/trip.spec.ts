import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('saves lodging dates without inventing a check-in time', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explorar demonstração' }).click();
  await page.getByRole('button', { name: 'Reservas e condições' }).click();
  const stay = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Hospedagem de demonstração' }) });
  await stay.getByRole('button', { name: 'Revisar condições' }).click();
  const editor = page.getByRole('dialog', { name: 'Condições do serviço' });
  await editor.getByLabel('Hora do início desconhecida').check();
  await expect(editor.getByLabel('Início local', { exact: true })).toHaveValue('2026-10-29');
  await editor.getByRole('button', { name: 'Validar e salvar' }).click();
  await expect(editor).toBeHidden();
  await stay.getByRole('button', { name: 'Revisar condições' }).click();
  await expect(editor.getByLabel('Início local', { exact: true })).toHaveValue('2026-10-29');
  await expect(editor.getByLabel('Hora do início desconhecida')).toBeChecked();
});

test('synthetic trip, evidence review, dossier and language', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Explorar demonstração' }).click();
  await expect(page.getByText('Margem de conexão insuficiente')).toBeVisible();
  await expect(page.getByText('Pernoite sem cobertura registrada')).toBeVisible();
  await page.getByRole('button', { name: 'Planejamento e rateio' }).click();
  await page.getByRole('combobox', { name: 'Ferramenta', exact: true }).selectOption('group-split');
  await page.getByRole('button', { name: 'Analisar dados' }).click();
  await expect(page.getByRole('cell', { name: 'N01', exact: true })).toBeVisible();
  await expect(page.locator('pre')).toContainText('"groupFinalCost": null');
  await page.getByRole('button', { name: 'Documentos e provas' }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'synthetic-evidence.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(
      'Cancellation: Synthetic fully refundable terms.\nBooking reference: SYNTHETIC-ONLY\nSupplier: Synthetic Provider\nDate: 2030-03-01\nTotal: BRL 1.234,56',
    ),
  });
  await expect(
    page.getByText('Synthetic fully refundable terms.', { exact: false }).first(),
  ).toBeVisible();
  await page.getByText('Fornecedor, datas e valores extraídos', { exact: true }).click();
  await expect(page.getByText('Synthetic Provider', { exact: true })).toBeVisible();
  await expect(page.getByText('2030-03-01 (date)', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Dossiê e exportações' }).click();
  await page.getByLabel('Pedido objetivo').fill('Synthetic request only.');
  await page.getByRole('button', { name: 'Gerar dossiê factual' }).click();
  await expect(page.locator('pre')).toContainText('Synthetic request only.');
  await page.getByLabel('Language', { exact: true }).selectOption('en');
  await expect(page.getByRole('heading', { name: 'Dossier & exports', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('shell accessibility and no sensitive offline cache', async ({ page }) => {
  await page.goto('/');
  const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze())
    .violations;
  expect(violations).toEqual([]);
  await page.getByRole('button', { name: 'Explorar demonstração' }).click();
  await expect(page.getByText('Margem de conexão insuficiente')).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations.map(
      (v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) }),
    ),
  ).toEqual([]);
  await page.evaluate(() => navigator.serviceWorker.ready);
  const urls = await page.evaluate(async () => {
    const result: string[] = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys())
        result.push(new URL(request.url).pathname);
    }
    return result;
  });
  expect(urls.some((url) => /^\/(v1|auth|hooks|public)\//.test(url))).toBe(false);
});
