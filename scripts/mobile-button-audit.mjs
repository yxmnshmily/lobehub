import { chromium } from 'playwright';

const baseURL = process.env.MOBILE_QA_BASE_URL || 'http://127.0.0.1:3010/lobehub';
const email = process.env.MOBILE_QA_EMAIL;
const password = process.env.MOBILE_QA_PASSWORD;

if (!email || !password) {
  throw new Error('MOBILE_QA_EMAIL and MOBILE_QA_PASSWORD are required');
}

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const context = await browser.newContext({
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
  locale: 'zh-CN',
  screen: { height: 844, width: 390 },
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  viewport: { height: 844, width: 390 },
});
const page = await context.newPage();
const consoleProblems = [];
const failedResponses = [];
const trpcResponses = [];

page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') {
    consoleProblems.push({
      location: message.location(),
      text: message.text(),
      type: message.type(),
      url: page.url(),
    });
  }
});
page.on('pageerror', (error) => {
  consoleProblems.push({ text: error.message, type: 'pageerror', url: page.url() });
});
page.on('response', (response) => {
  if (/\/trpc\//.test(response.url())) {
    trpcResponses.push({ status: response.status(), url: response.url() });
  }
  if (response.status() >= 400) {
    failedResponses.push({ status: response.status(), url: response.url() });
  }
});

const settle = async () => {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(800);
};

const audit = async (label) => {
  const result = await page.evaluate(() => {
    const selector = [
      'a[href]',
      'button',
      'input',
      'textarea',
      '[contenteditable="true"]',
      '[role="button"]',
      '[role="checkbox"]',
      '[role="combobox"]',
      '[role="link"]',
      '[role="switch"]',
    ].join(',');
    const seen = new Set();
    const controls = [...document.querySelectorAll(selector)]
      .filter((element) => {
        if (seen.has(element)) return false;
        seen.add(element);
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          rect.width > 0 &&
          rect.height > 0
        );
      })
      .map((element, index) => {
        const rect = element.getBoundingClientRect();
        const text = (element.innerText || element.textContent || '')
          .replaceAll(/\s+/g, ' ')
          .trim();
        const name =
          element.getAttribute('aria-label') ||
          element.getAttribute('title') ||
          element.getAttribute('placeholder') ||
          text;
        const disabled =
          element.hasAttribute('disabled') ||
          element.getAttribute('aria-disabled') === 'true' ||
          element.getAttribute('data-disabled') === 'true';
        return {
          ariaLabel: element.getAttribute('aria-label') || '',
          className: typeof element.className === 'string' ? element.className.slice(0, 120) : '',
          disabled,
          href: element instanceof HTMLAnchorElement ? element.href : undefined,
          index,
          insp: element.getAttribute('data-insp-path') || '',
          name: name.slice(0, 100),
          overflow:
            rect.left < -1 ||
            rect.right > window.innerWidth + 1 ||
            rect.top < -1 ||
            rect.bottom > window.innerHeight + 1,
          rect: {
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
            top: rect.top,
            width: rect.width,
          },
          title: element.getAttribute('title') || '',
          tag: element.tagName.toLowerCase(),
        };
      });

    return {
      bodyScrollWidth: document.body.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      controls,
      documentScrollWidth: document.documentElement.scrollWidth,
      layoutOverflow: [...document.querySelectorAll('*')]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            boxSizing: style.boxSizing,
            className: typeof element.className === 'string' ? element.className.slice(0, 120) : '',
            display: style.display,
            flex: style.flex,
            flexDirection: style.flexDirection,
            flexShrink: style.flexShrink,
            id: element.id,
            insp: element.getAttribute('data-insp-path') || '',
            margin: style.margin,
            maxWidth: style.maxWidth,
            minWidth: style.minWidth,
            overflowX: style.overflowX,
            outerHTML: element.outerHTML.slice(0, 320),
            padding: style.padding,
            position: style.position,
            rect: { left: rect.left, right: rect.right, width: rect.width },
            tag: element.tagName.toLowerCase(),
            text: (element.textContent || '').replaceAll(/\s+/g, ' ').trim().slice(0, 80),
          };
        })
        .filter(
          (item) =>
            item.rect.left < -1 || item.rect.right > document.documentElement.clientWidth + 1,
        )
        .sort((a, b) => b.rect.width - a.rect.width)
        .slice(0, 12),
      leakedDomProps: [
        ...document.querySelectorAll('[knowledgecutoff],[reasoning],[search],[structuredoutput]'),
      ].map((element) => ({
        attributes: Object.fromEntries(
          [...element.attributes].map((attribute) => [attribute.name, attribute.value]),
        ),
        className: typeof element.className === 'string' ? element.className.slice(0, 160) : '',
        insp:
          element.getAttribute('data-insp-path') ||
          element.closest('[data-insp-path]')?.getAttribute('data-insp-path') ||
          '',
        tag: element.tagName.toLowerCase(),
      })),
      serverIsMobile: window.__SERVER_CONFIG__?.isMobile,
      scripts: [...document.scripts]
        .map((script) => script.src)
        .filter(Boolean)
        .filter((src) => /index\.(?:mobile|desktop)|src\/spa\/entry/.test(src)),
      title: document.title,
      url: location.href,
      viewport: { height: window.innerHeight, width: window.innerWidth },
    };
  });

  if (label === 'group') {
    result.groupAncestorChain = await page.evaluate(() => {
      const start = document.querySelector(
        '[data-insp-path^="src/routes/(main)/group/_layout/index.tsx"]',
      );
      const chain = [];
      let element = start;
      while (element) {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        chain.push({
          className: typeof element.className === 'string' ? element.className.slice(0, 120) : '',
          display: style.display,
          flex: style.flex,
          insp: element.getAttribute('data-insp-path') || '',
          maxWidth: style.maxWidth,
          minWidth: style.minWidth,
          overflowX: style.overflowX,
          position: style.position,
          rect: { left: rect.left, right: rect.right, width: rect.width },
          tag: element.tagName.toLowerCase(),
          width: style.width,
        });
        element = element.parentElement;
      }
      return chain;
    });
  }

  result.label = label;
  result.horizontalOverflow = result.documentScrollWidth > result.clientWidth + 1;
  if (process.env.MOBILE_QA_COMPACT === '1') {
    console.log(
      JSON.stringify({
        controlCount: result.controls.length,
        horizontalOverflow: result.horizontalOverflow,
        label,
        leakedDomPropCount: result.leakedDomProps.length,
        layoutOverflowCount: result.layoutOverflow.length,
        type: 'snapshot',
        unnamedControls: result.controls
          .filter((control) => !control.name)
          .map(({ insp, index, tag }) => ({ index, insp, tag })),
        url: result.url,
      }),
    );
  } else {
    console.log(JSON.stringify({ type: 'snapshot', ...result }));
  }
  await page.screenshot({ path: `/tmp/mobile-button-audit-${label}.png` });
  return result;
};

const clickAndClose = async (name, label = name) => {
  const control = page.getByRole('button', { exact: true, name });
  if (!(await control.isVisible().catch(() => false))) {
    console.log(JSON.stringify({ label, result: 'missing', type: 'interaction' }));
    return;
  }
  try {
    const problemCountBeforeClick = consoleProblems.length;
    await control.click({ timeout: 3000 });
    await page.waitForTimeout(400);
    const leakedDomProps = await page.evaluate(() =>
      [
        ...document.querySelectorAll('[knowledgecutoff],[reasoning],[search],[structuredoutput]'),
      ].map((element) => ({
        attributes: Object.fromEntries(
          [...element.attributes].map((attribute) => [attribute.name, attribute.value]),
        ),
        className: typeof element.className === 'string' ? element.className.slice(0, 160) : '',
        insp:
          element.getAttribute('data-insp-path') ||
          element.closest('[data-insp-path]')?.getAttribute('data-insp-path') ||
          '',
        parentInsp:
          element.parentElement?.closest('[data-insp-path]')?.getAttribute('data-insp-path') || '',
        tag: element.tagName.toLowerCase(),
      })),
    );
    console.log(
      JSON.stringify({
        label,
        leakedDomProps,
        newConsoleProblems: consoleProblems.slice(problemCountBeforeClick),
        result: 'clicked',
        type: 'interaction',
        url: page.url(),
      }),
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        error: error instanceof Error ? error.message.split('\n', 1)[0] : String(error),
        label,
        result: 'blocked',
        type: 'interaction',
      }),
    );
    return;
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
};

try {
  await page.goto(`${baseURL}/signin?callbackUrl=%2Flobehub%2F`);
  await settle();
  await audit('signin-default');

  await clickAndClose('使用微信登录', 'signin-wechat');
  await clickAndClose('简体中文', 'signin-language');
  const theme = page.getByRole('button', { name: '切换主题' });
  if (await theme.isVisible().catch(() => false)) {
    await theme.click();
    await page.waitForTimeout(150);
    console.log(JSON.stringify({ label: 'signin-theme', result: 'clicked', type: 'interaction' }));
  }

  await page.getByRole('button', { name: '邮箱登录' }).click();
  await page.getByRole('button', { name: '创建账号' }).click();
  await settle();
  await audit('signup');
  const backToLogin = page.getByRole('button', { name: /返回登录|已有账号/ }).first();
  if (await backToLogin.isVisible().catch(() => false)) {
    await backToLogin.click();
  } else {
    await page.goto(`${baseURL}/signin?callbackUrl=%2Flobehub%2F`);
  }
  await settle();

  await page.getByRole('button', { name: '手机号登录' }).click();
  const phoneInput = page
    .locator('input[type="tel"], input')
    .filter({ hasNot: page.locator('[type="checkbox"]') })
    .first();
  await phoneInput.fill('13800138000');
  const smsButton = page.getByRole('button', { name: '获取验证码' });
  console.log(
    JSON.stringify({
      enabled: await smsButton.isEnabled(),
      label: 'signin-sms-submit-boundary',
      result: 'not-submitted',
      type: 'interaction',
    }),
  );

  await page.getByRole('button', { name: '邮箱登录' }).click();
  await page.getByPlaceholder('请输入邮箱或用户名').fill(email);
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByPlaceholder('请输入密码').fill(password);
  await audit('signin-password');
  await page.getByRole('button', { exact: true, name: '登录' }).click();
  await page.waitForURL((url) => url.pathname === '/lobehub/' || url.pathname === '/lobehub', {
    timeout: 10_000,
  });
  await page.waitForFunction(() => document.body !== null);
  await settle();
  await page.waitForTimeout(3000);
  const homeSnapshot = await audit('home');
  if (process.env.MOBILE_QA_STOP_AFTER_HOME === '1') process.exit(0);
  const agentHref = await page.locator('a[href*="/agent/"]').first().getAttribute('href');
  await clickAndClose('更多', 'home-session-more');
  for (const section of ['置顶', '默认列表']) {
    const collapse = page.getByRole('button', { exact: true, name: section });
    if (await collapse.isVisible().catch(() => false)) {
      await collapse.click();
      await page.waitForTimeout(150);
      await collapse.click();
      console.log(
        JSON.stringify({
          label: `home-collapse-${section}`,
          result: 'clicked-twice',
          type: 'interaction',
        }),
      );
    }
  }
  await page.locator('a[href*="/group/"]').first().waitFor({ state: 'visible', timeout: 10_000 });

  const groupLink = page.locator('a[href*="/group/"]').first();
  const groupHref = await groupLink.getAttribute('href');
  if (!groupHref) throw new Error('default travel group link is missing');
  await groupLink.click();
  await page.waitForURL(/\/group\//);
  await settle();
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(500);
  await audit('group');
  if (process.env.MOBILE_QA_STOP_AFTER_GROUP === '1') process.exit(0);

  const groupBack = page.getByRole('button', { exact: true, name: '返回' });
  await groupBack.click();
  await page.waitForURL((url) => url.pathname === '/lobehub/' || url.pathname === '/lobehub');
  console.log(JSON.stringify({ label: 'group-back', result: 'clicked', type: 'interaction' }));
  await page.locator('a[href*="/group/"]').first().click();
  await page.waitForURL(/\/group\//);
  await editor.waitFor({ state: 'visible', timeout: 10_000 });

  const groupHeader = page.getByRole('button', { name: /MO.*旅游服务超级群组/ });
  if (await groupHeader.isVisible().catch(() => false)) {
    await groupHeader.click();
    await page.waitForTimeout(250);
    console.log(
      JSON.stringify({ label: 'group-header-menu', result: 'clicked', type: 'interaction' }),
    );
    await page.keyboard.press('Escape');
  }

  const panelToggle = page.locator('#toggle_left_panel_button');
  if (await panelToggle.isVisible().catch(() => false)) {
    await panelToggle.click();
    await page.waitForTimeout(500);
    console.log(
      JSON.stringify({ label: 'group-sidebar-toggle', result: 'clicked', type: 'interaction' }),
    );
  }
  for (const name of [
    'DeepSeek V4 Flash',
    '推理强度',
    '联网搜索',
    '记忆',
    '上传',
    '技能',
    '显示格式工具栏',
    '高级参数',
  ]) {
    await clickAndClose(name, `group-composer-${name}`);
  }
  const clearMessages = page.getByRole('button', { exact: true, name: '清空当前会话消息' });
  if (await clearMessages.isVisible().catch(() => false)) {
    await clearMessages.click();
    await page.waitForTimeout(250);
    const cancel = page.getByRole('button', { exact: true, name: '取消' }).last();
    const hasCancel = await cancel.isVisible().catch(() => false);
    if (hasCancel) await cancel.click();
    console.log(
      JSON.stringify({
        label: 'group-clear-confirmation',
        result: hasCancel ? 'confirmation-cancelled' : 'confirmation-missing',
        type: 'interaction',
      }),
    );
  }
  const expandButton = page.getByRole('button', { exact: true, name: '展开' });
  if (await expandButton.isVisible().catch(() => false)) {
    await expandButton.click();
    await page.waitForTimeout(250);
    const collapseButton = page.getByRole('button', { name: /收起|退出/ }).first();
    const canCollapse = await collapseButton.isVisible().catch(() => false);
    if (canCollapse) await collapseButton.click();
    console.log(
      JSON.stringify({
        label: 'group-expand-toggle',
        result: canCollapse ? 'clicked-twice' : 'expand-only',
        type: 'interaction',
      }),
    );
  }
  if (process.env.MOBILE_QA_STOP_AFTER_COMPOSER === '1') {
    console.log(
      JSON.stringify({ consoleProblems, failedResponses, trpcResponses, type: 'composer-summary' }),
    );
    process.exit(0);
  }

  await editor.fill('第一行');
  await editor.press('Tab');
  await editor.type('第二行');
  const tabText = await editor.innerText();
  console.log(JSON.stringify({ label: 'group-tab-newline', result: tabText, type: 'interaction' }));
  await editor.press('Meta+A');
  await editor.press('Backspace');

  const credit = page.getByRole('spinbutton', { name: '本次最高消费 Credits' });
  console.log(
    JSON.stringify({
      enabled: await credit.isEnabled().catch(() => false),
      label: 'group-credit-boundary',
      result: 'not-submitted',
      type: 'interaction',
    }),
  );

  await credit.fill('1');
  await editor.fill('仅用于验证按钮，不发送');
  await page.waitForTimeout(500);
  const sendButton = page.getByRole('button', { exact: true, name: '发送' });
  const sendOptions = page.getByRole('button', { exact: true, name: '更多' }).first();
  const sendEnabled = await sendButton.isEnabled().catch(() => false);
  const optionsEnabled = await sendOptions.isEnabled().catch(() => false);
  if (optionsEnabled) {
    await sendOptions.click();
    await page.waitForTimeout(250);
    await page.keyboard.press('Escape');
  }
  console.log(
    JSON.stringify({
      label: 'group-send-boundary',
      optionsEnabled,
      result: 'not-submitted',
      sendEnabled,
      type: 'interaction',
    }),
  );
  await editor.fill('');
  await credit.fill('');

  if (agentHref) {
    await page.goto(new URL(agentHref, page.url()).href);
    await settle();
    await audit('agent-route');
    const agentEditor = page.locator('[contenteditable="true"]').first();
    if (await agentEditor.isVisible().catch(() => false)) {
      for (const name of [
        '推理强度',
        '联网搜索',
        '记忆',
        '上传',
        '技能',
        '显示格式工具栏',
        '高级参数',
      ]) {
        await clickAndClose(name, `agent-composer-${name}`);
      }
    } else {
      console.log(
        JSON.stringify({
          label: 'agent-composer',
          result: 'not-present-on-route',
          type: 'interaction',
        }),
      );
    }
  }

  await page.goto(`${baseURL}/settings/profile`);
  await settle();
  await audit('settings-profile');
  const changePassword = page.getByRole('button', { exact: true, name: '修改密码' });
  if (await changePassword.isVisible().catch(() => false)) {
    await changePassword.click();
    await page.waitForTimeout(250);
    await audit('profile-password-modal');
    const cancelPassword = page.getByRole('button', { exact: true, name: '取消' });
    if (await cancelPassword.isVisible().catch(() => false)) await cancelPassword.click();
  }

  await page.goto(`${baseURL}/me/profile`);
  await settle();
  await page.getByText('退出登录', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  await audit('profile');
  await page.getByText('退出登录', { exact: true }).click();
  await page.waitForURL(/\/signin/);
  await settle();
  await audit('signed-out');

  await page.getByRole('button', { name: '邮箱登录' }).click();
  await page.getByPlaceholder('请输入邮箱或用户名').fill(email);
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByPlaceholder('请输入密码').fill(password);
  await page.getByRole('button', { exact: true, name: '登录' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/signin'), { timeout: 10_000 });
  await page.goto(`${baseURL}/`);
  await settle();
  const restoredGroupHref = await page.locator('a[href*="/group/"]').first().getAttribute('href');
  console.log(
    JSON.stringify({
      label: 'group-restored-after-login',
      result: restoredGroupHref === groupHref,
      type: 'interaction',
      value: restoredGroupHref,
    }),
  );

  console.log(
    JSON.stringify({
      consoleProblems,
      failedResponses,
      homeControlCount: homeSnapshot.controls.length,
      trpcResponses,
      type: 'summary',
    }),
  );
} finally {
  await context.close();
  await browser.close();
}
