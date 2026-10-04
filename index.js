// @ts-nocheck
import { saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';

// === TOUCH SUPPORT (ДЛЯ МОБИЛЬНЫХ) ===
(function(){
    if (typeof jQuery === 'undefined' || typeof jQuery.ui === 'undefined') return;
    !function(a){function f(a,b){if(!(a.originalEvent.touches.length>1)){a.preventDefault();var c=a.originalEvent.changedTouches[0],d=document.createEvent("MouseEvents");d.initMouseEvent(b,!0,!0,window,1,c.screenX,c.screenY,c.clientX,c.clientY,!1,!1,!1,!1,0,null),a.target.dispatchEvent(d)}}if(a.support.touch="ontouchend"in document,a.support.touch){var e,b=a.ui.mouse.prototype,c=b._mouseInit,d=b._mouseDestroy;b._touchStart=function(a){var b=this;!e&&b._mouseCapture(a.originalEvent.changedTouches[0])&&(e=!0,b._touchMoved=!1,f(a,"mouseover"),f(a,"mousemove"),f(a,"mousedown"))},b._touchMove=function(a){e&&(this._touchMoved=!0,f(a,"mousemove"))},b._touchEnd=function(a){e&&(f(a,"mouseup"),f(a,"mouseout"),this._touchMoved||f(a,"click"),e=!1)},b._mouseInit=function(){var b=this;b.element.bind({touchstart:a.proxy(b,"_touchStart"),touchmove:a.proxy(b,"_touchMove"),touchend:a.proxy(b,"_touchEnd")}),c.call(b)},b._mouseDestroy=function(){var b=this;b.element.unbind({touchstart:a.proxy(b,"_touchStart"),touchmove:a.proxy(b,"_touchMove"),touchend:a.proxy(b,"_touchEnd")}),d.call(b)}}}(jQuery);
})();

const MODULE_NAME = "BB-Extension-Sorter";
const RESTORE_DEBOUNCE_MS = 250;

let layoutObserver = null;
let restoreTimer = null;
let suppressLayoutObserver = 0;
let restorePending = false;

if (!extension_settings[MODULE_NAME]) {
    extension_settings[MODULE_NAME] = { layout: { left: [], right: [], folders: {} } };
}

// === УМНЫЕ ФИЛЬТРЫ ===
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[char]));
}

function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeTitleForMatch(value) {
    return normalizeText(value).toLowerCase();
}

function cleanTitle(value) {
    return normalizeText(value)
        .replace(/[\u25bc\u25b2\u25be\u25b4]/g, '')
        .replace(/\ud83d[\udcc1\udcc2]/g, '')
        .trim();
}

function isRealExtension(el) {
    if ($(el).hasClass('bb-folder')) return true;
    if ($(el).hasClass('menu_button')) return false;
    if ($(el).attr('id') === 'bb-folder-controls') return false;
    if ($(el).find('.inline-drawer-header, .inline-drawer-toggle, .panel-heading').length === 0) return false;
    return true;
}

function getTitle(el) {
    if ($(el).hasClass('bb-folder')) return $(el).attr('data-name');
    
    const header = $(el).children('.inline-drawer-header, .inline-drawer-toggle, .panel-heading').first()
        .add($(el).find('.inline-drawer-header, .inline-drawer-toggle, .panel-heading').first())
        .first();
    let title = "";
    
    if (header.length > 0) {
        const titleSelectors = [
            '[data-extension-title]',
            '[data-extension-name]',
            '.extension-title',
            '.drawer-title',
            '.bbcv-settings-title',
            'b',
        ];

        for (const selector of titleSelectors) {
            const candidate = header.find(selector).first();
            const candidateTitle = cleanTitle(candidate.text());
            if (candidate.length > 0 && candidateTitle) {
                title = candidateTitle;
                break;
            }
        }

        if (!title) {
            let clone = header.clone();
            clone.find([
                '.inline-drawer-icon',
                '.fa-solid',
                '.fa-regular',
                '.fa-brands',
                '.menu_button',
                'button',
                'input',
                'select',
                'textarea',
                'small',
                '[id$="-counts"]',
                '[class*="subtitle"]',
                '[class*="counter"]',
                '[class*="count"]',
                '[class*="badge"]',
            ].join(', ')).remove();

            title = cleanTitle(clone.text());
            if (!title) title = cleanTitle(header.text());
        }
    } else {
        return null; 
    }
    return cleanTitle(title);
}

function getExtensionKey(el) {
    if ($(el).hasClass('bb-folder')) return null;
    const id = normalizeText($(el).attr('id'));
    return id ? `id:${id}` : null;
}

function getExtensionIdentity(el) {
    return {
        key: getExtensionKey(el),
        title: getTitle(el),
    };
}

function getLayoutExtItem(el, fallback = {}) {
    const identity = getExtensionIdentity(el);
    const item = {
        type: 'ext',
        title: identity.title || fallback.title || '',
    };
    if (identity.key || fallback.key) item.key = identity.key || fallback.key;
    return item;
}

function normalizeSavedExtensionRef(item) {
    if (typeof item === 'string') return { title: item, key: null };
    return {
        title: item?.title || '',
        key: item?.key || null,
    };
}

function titlesMatch(savedTitle, currentTitle) {
    const saved = normalizeTitleForMatch(savedTitle);
    const current = normalizeTitleForMatch(currentTitle);
    if (!saved || !current) return false;
    return saved === current || titleHasPrefix(saved, current) || titleHasPrefix(current, saved);
}

function titleHasPrefix(value, prefix) {
    if (!value.startsWith(prefix)) return false;
    const nextChar = value.charAt(prefix.length);
    return !nextChar || /[\s()[\]{}:;.,|/_-]/.test(nextChar);
}

function extensionMatches(el, ref) {
    const identity = getExtensionIdentity(el);
    if (ref.key && identity.key) return identity.key === ref.key;
    return titlesMatch(ref.title, identity.title);
}

function findFolderElement(name) {
    return $('.bb-folder').filter(function() {
        return $(this).attr('data-name') === name;
    }).first();
}

function findExtension(item) {
    const ref = normalizeSavedExtensionRef(item);
    if (!ref.title && !ref.key) return null;
    let found = null;
    let titleMatch = null;
    $('#extensions_settings > div, #extensions_settings2 > div, .bb-folder-content > div').not('.bb-folder').each(function() {
        if (!isRealExtension(this)) return;
        if (ref.key && getExtensionKey(this) === ref.key) { found = $(this); return false; }
        if (!titleMatch && extensionMatches(this, ref)) titleMatch = $(this);
    });
    return found || titleMatch;
}

function withLayoutObserverSuppressed(callback) {
    suppressLayoutObserver++;
    try {
        return callback();
    } finally {
        // Discard our synchronous moves, without ignoring other extensions on the next tick.
        layoutObserver?.takeRecords();
        suppressLayoutObserver--;
    }
}

function hasSavedLayout() {
    const layout = extension_settings[MODULE_NAME]?.layout;
    return !!(layout && (Array.isArray(layout.left) || Array.isArray(layout.right)));
}

function scheduleRestoreLayout(delay = RESTORE_DEBOUNCE_MS) {
    if (!hasSavedLayout()) return;
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(() => {
        restoreLayout();
    }, delay);
}

function isRelevantLayoutMutation(mutation) {
    if (mutation.type !== 'childList') return false;
    const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
    return nodes.some(node => node.nodeType === Node.ELEMENT_NODE && (
        isRealExtension(node)
        || node.matches('.inline-drawer-header, .inline-drawer-toggle, .panel-heading')
    ));
}

function initLayoutObserver() {
    const roots = [document.getElementById('extensions_settings'), document.getElementById('extensions_settings2')].filter(Boolean);
    if (!roots.length) return;

    if (layoutObserver) layoutObserver.disconnect();

    layoutObserver = new MutationObserver((mutations) => {
        if (suppressLayoutObserver > 0) return;
        if (!mutations.some(isRelevantLayoutMutation)) return;
        scheduleRestoreLayout();
    });

    roots.forEach(root => layoutObserver.observe(root, { childList: true, subtree: true }));
}

function closeSorterModal() {
    $('#bb-sort-modal-overlay').remove();
    if (restorePending) scheduleRestoreLayout(0);
}

function preserveMissingExtensions(layout, renamedFolders = {}) {
    const previous = extension_settings[MODULE_NAME].layout;
    const folderItems = data => Array.isArray(data) ? data : (data?.items || []);
    const allItems = [
        ...layout.left, ...layout.right,
        ...Object.values(layout.folders).flatMap(folderItems),
    ].filter(item => item.type !== 'folder');
    const preserve = (items, target) => {
        items.forEach((item, index) => {
            if (item.type === 'folder' || findExtension(item)) return;
            const ref = normalizeSavedExtensionRef(item);
            if (allItems.some(current => {
                const other = normalizeSavedExtensionRef(current);
                return ref.key && other.key ? ref.key === other.key : titlesMatch(ref.title, other.title);
            })) return;
            const savedItem = { type: 'ext', title: ref.title };
            if (ref.key) savedItem.key = ref.key;
            target.splice(Math.min(index, target.length), 0, savedItem);
            allItems.push(savedItem);
        });
    };
    for (const side of ['left', 'right']) {
        const items = previous?.[side] || [];
        preserve(items, layout[side]);
        items.filter(item => item.type === 'folder').forEach(item => {
            const name = renamedFolders[item.title] || item.title;
            // Deleting a folder releases even temporarily absent panels into its column.
            const target = layout.folders[name]?.items || layout[side];
            preserve(folderItems(previous.folders?.[item.title]), target);
        });
    }
}

// === УПРАВЛЕНИЕ РОДНЫМИ ПАПКАМИ ===
function createFolderElement(name, color = '#a855f7') {
    if (findFolderElement(name).length > 0) return;
    const safeName = escapeHtml(name);
    const safeColor = escapeHtml(color);
    
    const html = `
        <div class="inline-drawer bb-folder" data-name="${safeName}" style="--folder-color: ${safeColor};">
            <div class="bb-folder-toggle inline-drawer-header">
                <b class="bb-folder-title" style="color: var(--folder-color);">&#128193; ${safeName}</b>
                <div style="margin-left:auto; display:flex; gap:12px; align-items:center;">
                    <input type="color" class="bb-color-picker" value="${safeColor}" title="Изменить цвет">
                    <i class="fa-solid fa-pen bb-folder-edit-main" title="Переименовать" style="cursor:pointer; color: var(--folder-color);"></i>
                    <div class="inline-drawer-icon fa-solid fa-chevron-down down"></div>
                </div>
            </div>
            <div class="inline-drawer-content bb-folder-content" style="display:none;"></div>
        </div>
    `;
    $('#extensions_settings').prepend(html);
}

$('body').off('click', '.bb-folder > .bb-folder-toggle').on('click', '.bb-folder > .bb-folder-toggle', function(e) {
    if ($(e.target).closest('i, input').length) return; 
    const folder = $(this).closest('.bb-folder');
    folder.toggleClass('open');
    $(this).siblings('.inline-drawer-content').slideToggle(200);
    $(this).find('.inline-drawer-icon').toggleClass('down up');
});

$('body').off('change', '.bb-color-picker').on('change', '.bb-color-picker', function() {
    restoreLayout();
    const folder = $(this).closest('.bb-folder');
    const color = $(this).val();
    folder.css('--folder-color', color);
    folder.find('.bb-folder-title, .bb-folder-edit-main').css('color', color);
    saveLayoutMain();
});

$('body').off('click', '.bb-folder-edit-main').on('click', '.bb-folder-edit-main', function() {
    restoreLayout();
    const folder = $(this).closest('.bb-folder');
    const oldName = folder.attr('data-name');
    const newName = prompt("Новое имя папки:", oldName);
    if (newName && newName.trim() && newName.trim() !== oldName) {
        folder.attr('data-name', newName.trim());
        folder.find('.bb-folder-title').text('📁 ' + newName.trim());
        saveLayoutMain({ [oldName]: newName.trim() });
    }
});

function saveLayoutMain(renamedFolders = {}) {
    const layout = { left: [], right: [], folders: {} };
    
    const processCol = (selector, arr) => {
        $(selector).find('> div').each(function() {
            if (!isRealExtension(this)) return;

            if ($(this).hasClass('bb-folder')) {
                const fName = $(this).attr('data-name');
                const fColor = $(this).find('.bb-color-picker').val() || '#a855f7';
                arr.push({ type: 'folder', title: fName });
                layout.folders[fName] = { color: fColor, items: [] };
                
                $(this).find('.bb-folder-content > div').each(function() {
                    if (!isRealExtension(this)) return;
                    const item = getLayoutExtItem(this);
                    if (item.title || item.key) layout.folders[fName].items.push(item);
                });
            } else {
                const item = getLayoutExtItem(this);
                if (item.title || item.key) arr.push(item);
            }
        });
    };

    processCol('#extensions_settings', layout.left);
    processCol('#extensions_settings2', layout.right);

    preserveMissingExtensions(layout, renamedFolders);
    extension_settings[MODULE_NAME].layout = layout;
    saveSettingsDebounced();
}

function restoreLayout() {
    if ($('#bb-sort-modal-overlay').length) {
        restorePending = true;
        return;
    }
    restorePending = false;
    const layout = extension_settings[MODULE_NAME].layout;
    if (!layout || !layout.folders) return;

    withLayoutObserverSuppressed(() => {
        Object.keys(layout.folders).forEach(fName => {
            const folderData = layout.folders[fName];
            const color = folderData.color || '#a855f7';
            createFolderElement(fName, color);
        });

        const processCol = (colId, itemsArr) => {
            const col = $(colId);
            itemsArr.forEach(item => {
                if (item.type === 'folder') {
                    const folder = findFolderElement(item.title);
                    col.append(folder);
                    const folderData = layout.folders[item.title];
                    const items = Array.isArray(folderData) ? folderData : folderData.items;
                    if (items) {
                        items.forEach(extItem => {
                            const ext = findExtension(extItem);
                            if (ext) folder.find('.bb-folder-content').append(ext);
                        });
                    }
                } else {
                    const ext = findExtension(item);
                    if (ext) col.append(ext);
                }
            });
        };

        if (layout.left) processCol('#extensions_settings', layout.left);
        if (layout.right) processCol('#extensions_settings2', layout.right);
    });
}

// === СОРТИРОВКА В ПУЛЬТЕ ===
function initModalSortable() {
    const sortableOptions = {
        connectWith: '.bb-modal-col, .bb-light-folder-content',
        items: '> .bb-light-item',
        handle: '.bb-drag-handle', // <--- ВОТ ОНО! Хватаем только за ручку
        placeholder: 'bb-sortable-placeholder',
        tolerance: 'pointer',
        cursor: 'grabbing',
        helper: 'clone',
        appendTo: '#bb-sort-modal-overlay',
        zIndex: 999999,
        revert: 150,
        forcePlaceholderSize: true,
        refreshPositions: true,
        delay: 50 // Оставил минимальную задержку от случайных микро-свайпов
    };

    // Применяем к колонкам
    $('.bb-modal-col').sortable({
        ...sortableOptions,
        start: function(e, ui) {
            ui.placeholder.height(ui.item.outerHeight());
            if (ui.item.hasClass('bb-light-folder')) {
                $('body').addClass('bb-dragging-folder');
                $('.bb-modal-col').sortable('option', 'connectWith', '.bb-modal-col');
                $('.bb-modal-col').sortable('refresh');
            } else {
                $('body').addClass('bb-dragging-ext');
            }
        },
        stop: function(e, ui) {
            $('body').removeClass('bb-dragging-folder bb-dragging-ext');
            $('.bb-modal-col').sortable('option', 'connectWith', '.bb-modal-col, .bb-light-folder-content');
        }
    });

    // Применяем к содержимому папок
    $('.bb-light-folder-content').sortable({
        ...sortableOptions,
        items: '> .bb-light-item:not(.bb-light-folder)',
        start: function(e, ui) {
            ui.placeholder.height(ui.item.outerHeight());
            $('body').addClass('bb-dragging-ext');
        },
        stop: function(e, ui) {
            $('body').removeClass('bb-dragging-ext');
        }
    });
}

// === ПУЛЬТ УПРАВЛЕНИЯ ===
function openSorterModal() {
    if ($('#bb-sort-modal-overlay').length) return;
    restoreLayout();

    let foundExts = new Set();
    
    const getExtHtml = (el) => {
        if (!isRealExtension(el)) return ''; 
        const identity = getExtensionIdentity(el);
        const eName = identity.title;
        const eKey = identity.key;
        const dedupeKey = eKey || `title:${normalizeTitleForMatch(eName)}`;
        if (eName && !foundExts.has(dedupeKey)) {
            foundExts.add(dedupeKey);
            // Добавил иконку-ручку (.bb-drag-handle) перед пазлом
            return `<div class="bb-light-item" data-type="ext" data-title="${escapeHtml(eName)}" data-key="${escapeHtml(eKey || '')}">
                        <i class="fa-solid fa-grip-vertical bb-drag-handle"></i>
                        <i class="fa-solid fa-puzzle-piece"></i> ${escapeHtml(eName)}
                    </div>`;
        }
        return '';
    };

    const processColumnForModal = (selector) => {
        let html = '';
        $(selector).find('> div').each(function() {
            if (!isRealExtension(this)) return;

            if ($(this).hasClass('bb-folder')) {
                const fName = $(this).attr('data-name');
                const fColor = $(this).find('.bb-color-picker').val() || '#a855f7';
                const safeName = escapeHtml(fName);
                const safeColor = escapeHtml(fColor);
                html += `
                    <div class="bb-light-item bb-light-folder" data-type="folder" data-title="${safeName}" data-original-title="${safeName}" data-color="${safeColor}" style="--folder-color: ${safeColor};">
                        <div class="bb-light-folder-header">
                            <i class="fa-solid fa-grip-vertical bb-drag-handle" style="margin-right: 8px;"></i>
                            <i class="fa-solid fa-folder" style="color: var(--folder-color);"></i> <b class="folder-title-text" style="color: var(--folder-color);">${safeName}</b>
                            <i class="fa-solid fa-pen bb-edit-btn" style="margin-left:auto; cursor:pointer;" title="Переименовать"></i>
                            <i class="fa-solid fa-trash bb-del-btn" style="color:#ef4444; margin-left:10px; cursor:pointer;" title="Удалить"></i>
                        </div>
                        <div class="bb-light-folder-content">`;
                
                $(this).find('.bb-folder-content > div').each(function() {
                    html += getExtHtml(this);
                });
                html += `</div></div>`;
            } else {
                html += getExtHtml(this);
            }
        });
        return html;
    };

    const leftColHtml = processColumnForModal('#extensions_settings');
    const rightColHtml = processColumnForModal('#extensions_settings2');

    const modalHtml = `
        <div id="bb-sort-modal-overlay">
            <div class="popup wide_dialogue_popup flex-container flexGap" style="width: 800px; max-width: 90vw;">
                <div class="popup-header">
                    <h2>Управление сортировкой</h2>
                </div>
                
                <div class="popup-content bb-modal-grid" style="max-height: 60vh; overflow-y: auto;">
                    <div class="bb-modal-col" id="bb-modal-left">
                        <div class="bb-modal-col-title">Левая колонка</div>
                        ${leftColHtml}
                    </div>
                    <div class="bb-modal-col" id="bb-modal-right">
                        <div class="bb-modal-col-title">Правая колонка</div>
                        ${rightColHtml}
                    </div>
                </div>
                
                <div style="display: flex; gap: 10px; justify-content: space-between; margin-top: 15px;">
                    <div class="menu_button interactable" id="bb-modal-add-folder"><i class="fa-solid fa-folder-plus"></i>&nbsp;Создать папку</div>
                    <div style="display: flex; gap: 10px;">
                        <div class="menu_button interactable" id="bb-modal-cancel">Отмена</div>
                        <div class="menu_button interactable" id="bb-modal-save" style="border-color: var(--SmartThemeBorderColor, #a855f7);">Применить</div>
                    </div>
                </div>
            </div>
        </div>
    `;

    $('body').append(modalHtml);

    $('#bb-modal-add-folder').on('click', () => {
        const name = prompt("Название папки:");
        if (name) {
            const safeName = escapeHtml(name.trim());
            $('#bb-modal-left').append(`
                <div class="bb-light-item bb-light-folder" data-type="folder" data-title="${safeName}" data-color="#a855f7" style="--folder-color: #a855f7;">
                    <div class="bb-light-folder-header">
                        <i class="fa-solid fa-grip-vertical bb-drag-handle" style="margin-right: 8px;"></i>
                        <i class="fa-solid fa-folder" style="color: var(--folder-color);"></i> <b class="folder-title-text" style="color: var(--folder-color);">${safeName}</b>
                        <i class="fa-solid fa-pen bb-edit-btn" style="margin-left:auto; cursor:pointer;" title="Переименовать"></i>
                        <i class="fa-solid fa-trash bb-del-btn" style="color:#ef4444; margin-left:10px; cursor:pointer;" title="Удалить"></i>
                    </div>
                    <div class="bb-light-folder-content"></div>
                </div>
            `);
            initModalSortable(); 
        }
    });

    $('body').off('click', '.bb-del-btn').on('click', '.bb-del-btn', function() {
        const folder = $(this).closest('.bb-light-folder');
        const children = folder.find('.bb-light-folder-content > div');
        folder.parent().append(children); 
        folder.remove();
    });

    $('body').off('click', '.bb-edit-btn').on('click', '.bb-edit-btn', function() {
        const folder = $(this).closest('.bb-light-folder');
        const oldName = folder.attr('data-title');
        const newName = prompt("Новое имя:", oldName);
        
        if (newName && newName.trim() && newName.trim() !== oldName) {
            folder.attr('data-title', newName.trim());
            folder.find('.folder-title-text').text(newName.trim());
        }
    });

    $('#bb-modal-cancel').on('click', closeSorterModal);

    $('#bb-modal-save').on('click', () => {
        const layout = { left: [], right: [], folders: {} };
        const renamedFolders = {};
        const realLeftCol = $('#extensions_settings');
        const realRightCol = $('#extensions_settings2');
        
        const applyColumn = (modalColId, realCol, targetArray) => {
            $(modalColId).find('> .bb-light-item').each(function() {
                const type = $(this).attr('data-type');
                const title = $(this).attr('data-title');
                const key = $(this).attr('data-key') || null;
                
                if (type === 'folder') {
                    const originalTitle = $(this).attr('data-original-title');
                    if (originalTitle) renamedFolders[originalTitle] = title;
                    const color = $(this).attr('data-color') || '#a855f7';
                    createFolderElement(title, color); 
                    
                    const realFolder = findFolderElement(title);
                    realFolder.css('--folder-color', color);
                    realFolder.find('.bb-color-picker').val(color);
                    realFolder.find('.bb-folder-title, .bb-folder-edit-main').css('color', color);

                    realCol.append(realFolder);
                    targetArray.push({ type: 'folder', title: title });
                    layout.folders[title] = { color: color, items: [] };
                    
                    $(this).find('.bb-light-folder-content > div').each(function() {
                        const extTitle = $(this).attr('data-title');
                        const extKey = $(this).attr('data-key') || null;
                        const realExt = findExtension({ title: extTitle, key: extKey });
                        if (realExt) {
                            realFolder.find('.bb-folder-content').append(realExt);
                        }
                        layout.folders[title].items.push(realExt
                            ? getLayoutExtItem(realExt, { title: extTitle, key: extKey })
                            : { type: 'ext', title: extTitle, ...(extKey ? { key: extKey } : {}) });
                    });
                } else {
                    const realExt = findExtension({ title, key });
                    if (realExt) {
                        realCol.append(realExt);
                    }
                    targetArray.push(realExt
                        ? getLayoutExtItem(realExt, { title, key })
                        : { type: 'ext', title, ...(key ? { key } : {}) });
                }
            });
        };

        withLayoutObserverSuppressed(() => {
            applyColumn('#bb-modal-left', realLeftCol, layout.left);
            applyColumn('#bb-modal-right', realRightCol, layout.right);

            $('.bb-folder').each(function() {
                const fName = $(this).attr('data-name');
                if (!layout.folders[fName]) $(this).remove();
            });
        });

        preserveMissingExtensions(layout, renamedFolders);
        extension_settings[MODULE_NAME].layout = layout;
        saveSettingsDebounced();
        closeSorterModal();
    });

    initModalSortable(); 
}

function injectControls() {
    if ($('#bb-open-sorter-btn').length > 0) return;
    
    // Добавил margin-bottom: 5px, чтобы на мобилках кнопка не прилипала к нижним элементам
    const btnHtml = `
        <div id="bb-open-sorter-btn" class="menu_button interactable" style="display:inline-flex; align-items:center; gap:6px; margin-right:5px; margin-bottom:5px; border-color: var(--SmartThemeBorderColor, #a855f7);">
            <i class="fa-solid fa-list-check"></i>
            <span>Управление сортировкой</span>
        </div>
    `;

    const targetBtn = $('.menu_button:has(.fa-cubes)').first();
    if (targetBtn.length > 0) {
        // Убрали грязный хак с .parent().css(...), чтобы не ломать заводскую верстку Таверны!
        targetBtn.before(btnHtml);
    } else {
        $('#extensions_settings').before(`<div style="margin-bottom:10px;">${btnHtml}</div>`);
    }

    $('#bb-open-sorter-btn').off('click').on('click', openSorterModal);
}

jQuery(async () => {
    try {
        const { eventSource, event_types } = SillyTavern.getContext();
        eventSource.on(event_types.APP_READY, () => {
            setTimeout(() => {
                injectControls();
                restoreLayout();
                initLayoutObserver();
                
                let checkAttempts = 0;
                let heartbeat = setInterval(() => {
                    restoreLayout();
                    initLayoutObserver();
                    checkAttempts++;
                    if (checkAttempts >= 5) clearInterval(heartbeat);
                }, 2000);

            }, 2000);
        });
    } catch (e) {
        console.error("[BB Sorter] Ошибка:", e);
    }
});
