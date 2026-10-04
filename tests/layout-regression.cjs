// Run with Playwright available through NODE_PATH:
// node --test tests/layout-regression.cjs
// SORTER_BROWSER_CHANNEL=msedge selects an installed Edge instead of bundled Chromium.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const publicDir = path.resolve(__dirname, '../../../../..');
const source = fs.readFileSync(path.resolve(__dirname, '../index.js'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .split('jQuery(async () => {')[0];

test('saved layout survives extension panel replacement', async (t) => {
    const browser = await chromium.launch({
        headless: true,
        ...(process.env.SORTER_BROWSER_CHANNEL ? { channel: process.env.SORTER_BROWSER_CHANNEL } : {}),
    });
    t.after(() => browser.close());

    async function fixture() {
        const page = await browser.newPage();
        await page.setContent('<div id="extensions_settings"></div><div id="extensions_settings2"></div>');
        await page.addScriptTag({ path: path.join(publicDir, 'lib/jquery-3.5.1.min.js') });
        await page.addScriptTag({ path: path.join(publicDir, 'lib/jquery-ui.min.js') });
        await page.evaluate(() => {
            window.extension_settings = {
                'BB-Extension-Sorter': { layout: {
                    left: [{ type: 'folder', title: 'Art' }], right: [],
                    folders: { Art: { color: '#a855f7', items: [
                        { type: 'ext', title: 'BB Comic Forge', key: 'id:bbcf-settings' },
                        { type: 'ext', title: 'Other', key: 'id:other-settings' },
                    ] } },
                } },
            };
            window.saveSettingsDebounced = () => {};
            window.addPanel = (id = 'bbcf-settings', title = 'BB Comic Forge') => {
                const panel = document.createElement('div');
                panel.id = id;
                panel.innerHTML = `<div class="inline-drawer-header"><b>${title}</b></div>`;
                document.getElementById('extensions_settings').append(panel);
                return panel;
            };
            addPanel();
            addPanel('other-settings', 'Other');
        });
        await page.addScriptTag({ content: source });
        await page.evaluate(() => { restoreLayout(); initLayoutObserver(); });
        return page;
    }

    async function restored(page, id = 'bbcf-settings', folder = 'Art') {
        await page.waitForFunction(({ id, folder }) =>
            document.getElementById(id)?.closest('.bb-folder')?.dataset.name === folder,
        { id, folder }, { timeout: 2000 });
    }

    await t.test('repeated replacement returns to the folder without a restore loop', async () => {
        const page = await fixture();
        await page.evaluate(() => {
            const original = restoreLayout;
            window.restoreCalls = 0;
            restoreLayout = () => { window.restoreCalls++; original(); };
        });
        for (let i = 0; i < 3; i++) {
            await page.evaluate(() => { document.getElementById('bbcf-settings').remove(); addPanel(); });
            await restored(page);
        }
        await new Promise(resolve => setTimeout(resolve, 350));
        assert.equal(await page.evaluate(() => window.restoreCalls), 3);
        assert.equal(await page.locator('[id="bbcf-settings"]').count(), 1);
        await page.close();
    });

    await t.test('late header construction is detected', async () => {
        const page = await fixture();
        await page.evaluate(() => {
            document.getElementById('bbcf-settings').remove();
            const panel = document.createElement('div');
            panel.id = 'bbcf-settings';
            document.getElementById('extensions_settings').append(panel);
        });
        await page.evaluate(() => {
            document.getElementById('bbcf-settings').innerHTML = '<div class="inline-drawer-header"><b>BB Comic Forge</b></div>';
        });
        await restored(page);
        await page.close();
    });

    await t.test('replacement immediately after sorter moves is observed', async () => {
        const page = await fixture();
        await page.evaluate(() => {
            restoreLayout();
            document.getElementById('bbcf-settings').remove();
            addPanel();
        });
        await restored(page);
        await page.close();
    });

    await t.test('cancel processes replacement deferred while the modal is open', async () => {
        const page = await fixture();
        await page.evaluate(() => { openSorterModal(); document.getElementById('bbcf-settings').remove(); addPanel(); });
        await page.waitForFunction(() => restorePending, null, { timeout: 2000 });
        assert.equal(await page.evaluate(() => document.getElementById('bbcf-settings').parentElement.id), 'extensions_settings');
        await page.locator('#bb-modal-cancel').click();
        await restored(page);
        await page.close();
    });

    await t.test('apply retains a panel removed after opening the modal', async () => {
        const page = await fixture();
        await page.evaluate(() => { openSorterModal(); document.getElementById('bbcf-settings').remove(); });
        await page.locator('#bb-modal-save').click();
        assert.equal(await page.evaluate(() => extension_settings[MODULE_NAME].layout.folders.Art.items[0].key), 'id:bbcf-settings');
        await page.evaluate(() => addPanel());
        await restored(page);
        await page.close();
    });

    await t.test('main save preserves an absent panel and neighboring order', async () => {
        const page = await fixture();
        await page.evaluate(() => { document.getElementById('bbcf-settings').remove(); saveLayoutMain(); });
        assert.deepEqual(await page.evaluate(() => extension_settings[MODULE_NAME].layout.folders.Art.items.map(item => item.key)),
            ['id:bbcf-settings', 'id:other-settings']);
        await page.evaluate(() => addPanel());
        await restored(page);
        await page.close();
    });

    await t.test('rename preserves panels absent before opening the modal', async () => {
        const page = await fixture();
        await page.evaluate(() => {
            document.getElementById('bbcf-settings').remove();
            openSorterModal();
            $('#bb-modal-left .bb-light-folder').attr('data-title', 'Renamed');
        });
        await page.locator('#bb-modal-save').click();
        await page.evaluate(() => addPanel());
        await restored(page, 'bbcf-settings', 'Renamed');
        await page.close();
    });

    await t.test('deleting a folder releases absent panels into its column', async () => {
        const page = await fixture();
        await page.evaluate(() => { document.getElementById('bbcf-settings').remove(); openSorterModal(); });
        // Font Awesome is not loaded in this fixture; dispatch the icon's actual click handler.
        await page.evaluate(() => $('.bb-del-btn').trigger('click'));
        await page.locator('#bb-modal-save').click();
        assert.equal(await page.evaluate(() => Object.keys(extension_settings[MODULE_NAME].layout.folders).length), 0);
        assert.equal(await page.evaluate(() => extension_settings[MODULE_NAME].layout.left.some(item => item.key === 'id:bbcf-settings')), true);
        await page.close();
    });

    await t.test('manual moves remain saved and exact IDs beat similar titles', async () => {
        const page = await fixture();
        await page.evaluate(() => {
            const impostor = addPanel('another-comic', 'BB Comic Forge');
            document.getElementById('extensions_settings').prepend(impostor);
        });
        assert.equal(await page.evaluate(() => findExtension({ key: 'id:bbcf-settings', title: 'BB Comic Forge' }).attr('id')), 'bbcf-settings');
        await page.evaluate(() => openSorterModal());
        await page.evaluate(() => $('#bb-modal-right').append($('.bb-light-item[data-key="id:bbcf-settings"]')));
        await page.locator('#bb-modal-save').click();
        await page.evaluate(() => { document.getElementById('bbcf-settings').remove(); addPanel(); });
        await page.waitForFunction(() => document.getElementById('bbcf-settings')?.parentElement.id === 'extensions_settings2', null, { timeout: 2000 });
        assert.equal(await page.evaluate(() => document.getElementById('other-settings').closest('.bb-folder').dataset.name), 'Art');
        await page.close();
    });

    await t.test('a different keyed panel cannot replace an absent namesake', async () => {
        const page = await fixture();
        await page.evaluate(() => {
            document.getElementById('bbcf-settings').remove();
            addPanel('another-comic', 'BB Comic Forge');
            saveLayoutMain();
        });
        assert.equal(await page.evaluate(() => extension_settings[MODULE_NAME].layout.folders.Art.items[0].key), 'id:bbcf-settings');
        await page.evaluate(() => addPanel());
        await restored(page);
        assert.equal(await page.evaluate(() => document.getElementById('another-comic').parentElement.id), 'extensions_settings');
        await page.close();
    });

    await t.test('legacy title references still restore and survive temporary absence', async () => {
        const page = await fixture();
        await page.evaluate(() => {
            extension_settings[MODULE_NAME].layout.folders.Art = ['BB Comic Forge', 'Other'];
            document.getElementById('bbcf-settings').remove();
            saveLayoutMain();
            addPanel();
        });
        await restored(page);
        assert.equal(await page.evaluate(() => document.getElementById('other-settings').closest('.bb-folder').dataset.name), 'Art');
        await page.close();
    });
});
