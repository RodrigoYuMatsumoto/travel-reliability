import { test as base, expect, type BrowserContext } from '@playwright/test';
import { buildApp } from '../../api/src/app.js';
import { loadConfig } from '../../api/src/config.js';

type DemoStorageState = Awaited<ReturnType<BrowserContext['storageState']>>;
type DemoRuntime = { origin: string; storageState: DemoStorageState };
const test = base.extend<{}, { demoRuntime: DemoRuntime }>({
  // Isolate each worker's deployment and its real rate-limit counters. Shared-IP
  // load is not the subject of these planning scenarios. Authentication and the
  // service worker remain real; session state and application stores stay in RAM.
  demoRuntime: [
    async ({ browser }, use) => {
      const config = loadConfig({
        APP_MODE: 'demo',
        HOST: '127.0.0.1',
        PORT: '4310',
        PUBLIC_URL: 'http://127.0.0.1:4310',
        LLM_ENABLED: 'false',
        ALLOW_DEMO_EXTERNAL_STORES: 'false',
      });
      const { app } = await buildApp(config);
      let context: BrowserContext | undefined;
      try {
        const origin = await app.listen({ host: '127.0.0.1', port: 0 });
        // The validated demo configuration receives the actual OS-assigned origin
        // before the first request; Auth checks Origin and cookie flags from it.
        config.publicUrl = origin;
        config.port = Number(new URL(origin).port);
        context = await browser.newContext({ baseURL: origin });
        const page = await context.newPage();
        await page.goto('/');
        const login = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === '/auth/demo' &&
            response.request().method() === 'POST',
        );
        await page.getByRole('button', { name: 'Explorar demonstração' }).click();
        expect((await login).status()).toBe(200);
        await expect(page.getByText('Margem de conexão insuficiente')).toBeVisible();
        await use({ origin, storageState: await context.storageState() });
      } finally {
        await context?.close();
        await app.close();
      }
    },
    { scope: 'worker' },
  ],
  baseURL: async ({ demoRuntime }, use) => {
    await use(demoRuntime.origin);
  },
  storageState: async ({ demoRuntime }, use) => {
    await use(demoRuntime.storageState);
  },
});

test('finds agency references for two periods and prepares bus and flight quotes without fake prices', async ({
  page,
}) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith('http') && !['127.0.0.1', 'localhost'].includes(url.hostname))
      externalRequests.push(url.hostname);
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Planejamento e rateio' }).click();
  const discovery = page.getByRole('region', { name: 'Encontrar excursões locais' });
  await discovery.getByLabel('Saída a partir de').fill('2026-12-24');
  await discovery.getByLabel('Chegada de volta até').fill('2026-12-27');
  await discovery.getByRole('button', { name: 'Adicionar outro período' }).click();
  await discovery.getByLabel('Saída a partir de').nth(1).fill('2026-12-30');
  await discovery.getByLabel('Chegada de volta até').nth(1).fill('2027-01-03');
  await expect(discovery.getByLabel('Fuso IANA da origem')).toHaveValue('America/Recife');
  await discovery.getByRole('button', { name: 'Encontrar páginas das agências' }).click();
  await expect(
    discovery.getByText('Referências encontradas no catálogo', { exact: false }),
  ).toBeVisible();
  await expect(
    discovery.getByRole('button', { name: 'Preparar comparação sem preços presumidos' }).first(),
  ).toBeDisabled();
  await discovery.getByRole('combobox', { name: 'Período para esta comparação' }).selectOption('1');
  await discovery.getByRole('button', { name: 'Próximas referências' }).click();
  await expect(
    discovery.getByRole('combobox', { name: 'Período para esta comparação' }),
  ).toHaveValue('1');
  await discovery
    .getByRole('button', { name: 'Preparar comparação sem preços presumidos' })
    .first()
    .click();
  await expect(page.getByRole('combobox', { name: 'Ferramenta', exact: true })).toHaveValue(
    'ground-transport',
  );
  const draft = JSON.parse(
    await page.getByRole('textbox', { name: 'Dados estruturados', exact: true }).inputValue(),
  );
  expect(draft.requestedWindow.earliestDepartureAt).toBe('2026-12-30T00:00:00-03:00');
  expect(draft.requestedWindow.latestReturnAt).toBe('2027-01-03T23:59:59-03:00');
  expect(
    draft.offers.every((offer: { costs: Array<{ unitMinor: unknown }> }) =>
      offer.costs.every((cost) => cost.unitMinor === null),
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Analisar dados' }).click();
  await expect(page.locator('pre')).toContainText('"finalTotalMinor": null');
  await expect(page.getByRole('table').getByText('A cotar', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('table').getByText('Avião', { exact: true }).first()).toBeVisible();
  await page.getByRole('table').getByText('Ver pendências', { exact: false }).first().click();
  await expect(page.getByRole('table')).toContainText(
    'O valor de um dos itens ainda precisa ser cotado.',
  );
  await expect(page.getByRole('table')).toContainText('Confirme o ano anunciado para a viagem.');
  await expect(page.getByRole('table')).not.toContainText('COST_UNKNOWN:');
  await expect(page.getByRole('table')).not.toContainText('OFFER_YEAR_UNCONFIRMED');
  expect(externalRequests).toEqual([]);
});

test('locks discovery while a calculation is pending and prevents previous results from appearing under another period', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Planejamento e rateio' }).click();
  const discovery = page.getByRole('region', { name: 'Encontrar excursões locais' });
  await discovery.getByLabel('Saída a partir de').fill('2026-12-24');
  await discovery.getByLabel('Chegada de volta até').fill('2026-12-27');
  await discovery.getByRole('button', { name: 'Adicionar outro período' }).click();
  await discovery.getByLabel('Saída a partir de').nth(1).fill('2026-12-30');
  await discovery.getByLabel('Chegada de volta até').nth(1).fill('2027-01-03');
  await discovery.getByRole('button', { name: 'Encontrar páginas das agências' }).click();
  const period = discovery.getByRole('combobox', { name: 'Período para esta comparação' });
  await period.selectOption('0');
  const prepare = discovery
    .getByRole('button', { name: 'Preparar comparação sem preços presumidos' })
    .first();
  await prepare.click();
  let release!: () => void;
  let markStarted!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  await page.route('**/v1/tools/ground-transport', async (route) => {
    markStarted();
    await held;
    await route.continue();
  });
  try {
    await page.getByRole('button', { name: 'Analisar dados' }).click();
    await started;
    await expect(prepare).toBeDisabled();
    await expect(period).toBeDisabled();
    await expect(discovery.getByLabel('Cidade de saída')).toBeDisabled();
    await expect(discovery.getByLabel('Fuso IANA da origem')).toBeDisabled();
    release();
    await expect(
      page.getByRole('heading', { name: 'Resultado e pendências', exact: true }),
    ).toBeVisible();
    await period.selectOption('1');
    await expect(
      page.getByRole('heading', { name: 'Resultado e pendências', exact: true }),
    ).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Analisar dados' })).toBeDisabled();
    await expect(
      page.getByText('Os critérios da pesquisa mudaram.', { exact: false }),
    ).toBeVisible();
    // Editing takes ownership of the draft: analysis no longer requires discarding it.
    const editor = page.getByRole('textbox', { name: 'Dados estruturados', exact: true });
    const edited = (await editor.inputValue()).replace('"adults": null', '"adults": 2');
    await editor.fill(edited);
    await expect(page.getByRole('button', { name: 'Analisar dados' })).toBeEnabled();
    await expect(editor).toHaveValue(edited);
    await expect(
      page.getByText('A análise usa os dados abaixo como estão', { exact: false }),
    ).toBeVisible();
    await prepare.click();
    const draft = JSON.parse(
      await page.getByRole('textbox', { name: 'Dados estruturados', exact: true }).inputValue(),
    );
    expect(draft.requestedWindow.earliestDepartureAt).toContain('2026-12-30');
    await expect(page.getByRole('button', { name: 'Analisar dados' })).toBeEnabled();
    await expect(
      page.getByRole('heading', { name: 'Resultado e pendências', exact: true }),
    ).not.toBeVisible();
  } finally {
    release();
    await page.unroute('**/v1/tools/ground-transport');
  }
});

test('keeps another tool result when discovery criteria change', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Planejamento e rateio' }).click();
  await page.getByRole('combobox', { name: 'Ferramenta', exact: true }).selectOption('group-split');
  await page.getByRole('button', { name: 'Analisar dados' }).click();
  const heading = page.getByRole('heading', { name: 'Resultado e pendências', exact: true });
  await expect(heading).toBeVisible();
  const discovery = page.getByRole('region', { name: 'Encontrar excursões locais' });
  await discovery.getByLabel('Cidade de saída').fill('Juazeiro, BA');
  await discovery.getByLabel('Saída a partir de').fill('2026-12-24');
  await expect(heading).toBeVisible();
  await expect(page.getByRole('button', { name: 'Analisar dados' })).toBeEnabled();
  await expect(page.getByText('Os critérios da pesquisa mudaram.', { exact: false })).toHaveCount(
    0,
  );
});

test('invalidates the executed discovery snapshot when origin, destination, dates, agencies or time zone change', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Planejamento e rateio' }).click();
  const discovery = page.getByRole('region', { name: 'Encontrar excursões locais' });
  await discovery.getByLabel('Saída a partir de').fill('2026-12-24');
  await discovery.getByLabel('Chegada de volta até').fill('2026-12-27');
  const changes = [
    () => discovery.getByLabel('Cidade de saída').fill('Juazeiro, BA'),
    () => discovery.getByLabel('Destino (opcional)').fill('Aracaju, SE'),
    () => discovery.getByLabel('Saída a partir de').fill('2026-12-23'),
    () => discovery.getByRole('checkbox', { name: 'Niel Turismo', exact: true }).uncheck(),
    () => discovery.getByLabel('Fuso IANA da origem').fill('America/Los_Angeles'),
  ];
  for (const change of changes) {
    await discovery.getByRole('button', { name: 'Encontrar páginas das agências' }).click();
    await expect(
      discovery.getByText('Referências encontradas no catálogo', { exact: false }),
    ).toBeVisible();
    await change();
    await expect(
      discovery.getByText('Referências encontradas no catálogo', { exact: false }),
    ).not.toBeVisible();
    await expect(
      discovery.getByRole('button', { name: 'Preparar comparação sem preços presumidos' }),
    ).toHaveCount(0);
    await expect(
      discovery.getByRole('combobox', { name: 'Período para esta comparação' }),
    ).toHaveCount(0);
  }
});

test('renders synthetic package arbitrage totals, scope and unknown prices without inventing savings or currency', async ({
  page,
}) => {
  const externalRequests: string[] = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol.startsWith('http') && !['127.0.0.1', 'localhost'].includes(url.hostname)) {
      externalRequests.push(url.hostname);
      await route.abort();
    } else await route.continue();
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Planejamento e rateio' }).click();
  await page
    .getByRole('combobox', { name: 'Ferramenta', exact: true })
    .selectOption('package-arbitrage');
  const editor = page.getByRole('textbox', { name: 'Dados estruturados', exact: true });
  const input = JSON.parse(await editor.inputValue());
  // Every amount remains synthetic. A non-BRL currency detects an invented BRL default.
  input.currency = 'USD';
  input.package.price.currency = 'USD';
  for (const quotes of Object.values(input.quotes) as Array<
    Array<{ currency: string; unitMinor: number | null }>
  >) {
    for (const quote of quotes) quote.currency = 'USD';
  }
  await editor.fill(JSON.stringify(input));
  await page.getByRole('button', { name: 'Analisar dados' }).click();
  const table = page.getByRole('table', {
    name: 'Pacote da agência e compra separada: cenários documentados',
  });
  await expect(table).toBeVisible();
  await expect(table.getByRole('row')).toHaveCount(5);
  await expect(table).toContainText('US$');
  await expect(table).not.toContainText('R$');
  await expect(table).toContainText('1.810,00');
  await expect(
    table.getByRole('cell', { name: 'Equivalente ao pacote', exact: false }),
  ).toHaveCount(1);
  await expect(table).toContainText('Comparação final dos valores informados');
  const flightRows = table
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: 'Avião', exact: true }) });
  await expect(flightRows).toHaveCount(2);
  await expect(flightRows.first()).toContainText('Deságio da agência');
  await expect(flightRows.first()).toContainText('Alternativa com serviços diferentes');
  await expect(flightRows.first()).toContainText('Diferença nominal; não demonstra economia.');
  await expect(flightRows.first()).not.toContainText('Comparação final dos valores informados');
  await expect(flightRows.locator('.success, .positive, .winner')).toHaveCount(0);

  input.package.price.amountMinor = null;
  for (const quote of input.quotes.transport) quote.unitMinor = null;
  await editor.fill(JSON.stringify(input));
  await page.getByRole('button', { name: 'Analisar dados' }).click();
  await expect(table.getByRole('row')).toHaveCount(5);
  await expect(table.getByRole('cell', { name: 'A cotar', exact: true })).toHaveCount(12);
  await expect(table).not.toContainText('US$');
  await expect(table).not.toContainText('0,00');
  await expect(table).not.toContainText('PACKAGE_PRICE_UNKNOWN');
  await expect(table).not.toContainText('TRANSPORT_PRICE_UNKNOWN');
  await table.getByText('Ver pendências', { exact: false }).first().click();
  await expect(table).toContainText('O preço do pacote ainda precisa ser cotado.');
  await expect(page.locator('pre')).toContainText('PACKAGE_PRICE_UNKNOWN');
  await expect(page.locator('pre')).toContainText('TRANSPORT_PRICE_UNKNOWN');
  expect(externalRequests).toEqual([]);
});
