// @ts-nocheck
import { saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';

// === TOUCH SUPPORT (ДЛЯ МОБИЛЬНЫХ) ===
(function(){
    if (typeof jQuery === 'undefined' || typeof jQuery.ui === 'undefined') return;
    !function(a){function f(a,b){if(!(a.originalEvent.touches.length>1)){a.preventDefault();var c=a.originalEvent.changedTouches[0],d=document.createEvent("MouseEvents");d.initMouseEvent(b,!0,!0,window,1,c.screenX,c.screenY,c.clientX,c.clientY,!1,!1,!1,!1,0,null),a.target.dispatchEvent(d)}}if(a.support.touch="ontouchend"in document,a.support.touch){var e,b=a.ui.mouse.prototype,c=b._mouseInit,d=b._mouseDestroy;b._touchStart=function(a){var b=this;!e&&b._mouseCapture(a.originalEvent.changedTouches[0])&&(e=!0,b._touchMoved=!1,f(a,"mouseover"),f(a,"mousemove"),f(a,"mousedown"))},b._touchMove=function(a){e&&(this._touchMoved=!0,f(a,"mousemove"))},b._touchEnd=function(a){e&&(f(a,"mouseup"),f(a,"mouseout"),this._touchMoved||f(a,"click"),e=!1)},b._mouseInit=function(){var b=this;b.element.bind({touchstart:a.proxy(b,"_touchStart"),touchmove:a.proxy(b,"_touchMove"),touchend:a.proxy(b,"_touchEnd")}),c.call(b)},b._mouseDestroy=function(){var b=this;b.element.unbind({touchstart:a.proxy(b,"_touchStart"),touchmove:a.proxy(b,"_touchMove"),touchend:a.proxy(b,"_touchEnd")}),d.call(b)}}}(jQuery);
})();

const MODULE_NAME = "BB-Extension-Sorter";

if (!extension_settings[MODULE_NAME]) {
    extension_settings[MODULE_NAME] = { layout: { left: [], right: [], folders: {} } };
}

// === УМНЫЕ ФИЛЬТРЫ ===
function isRealExtension(el) {
    if ($(el).hasClass('bb-folder')) return true;
    if ($(el).hasClass('menu_button')) return false;
    if ($(el).attr('id') === 'bb-folder-controls') return false;
    if ($(el).find('.inline-drawer-header, .inline-drawer-toggle, .panel-heading').length === 0) return false;
    return true;
}

function getTitle(el) {
    if ($(el).hasClass('bb-folder')) return $(el).attr('data-name');
    
    const header = $(el).find('.inline-drawer-header, .inline-drawer-toggle, .panel-heading').first();
    let title = "";
    
    if (header.length > 0) {
        const b = header.find('b').first();
        if (b.length > 0 && b.text().trim() !== '') {
            title = b.text();
        } else {
            let clone = header.clone();
            clone.children().remove();
            title = clone.text();
            if (!title.trim()) title = header.text();
        }
    } else {
        return null; 
    }
    return title.replace(/▼|▲|📂|📁/g, '').trim();
}

function findExtension(title) {
    if (!title) return null;
    let found = null;
    $('#extensions_settings > div, #extensions_settings2 > div, .bb-folder-content > div').not('.bb-folder').each(function() {
        if (isRealExtension(this) && getTitle(this) === title) { found = $(this); return false; }
    });
    return found;
}

// === УПРАВЛЕНИЕ РОДНЫМИ ПАПКАМИ ===
function createFolderElement(name, color = '#a855f7') {
    if ($(`.bb-folder[data-name="${name}"]`).length > 0) return; 
    
    const html = `
        <div class="inline-drawer bb-folder" data-name="${name}" style="--folder-color: ${color};">
            <div class="bb-folder-toggle inline-drawer-header">
                <b class="bb-folder-title" style="color: var(--folder-color);">📁 ${name}</b>
                <div style="margin-left:auto; display:flex; gap:12px; align-items:center;">
                    <input type="color" class="bb-color-picker" value="${color}" title="Изменить цвет">
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
    const folder = $(this).closest('.bb-folder');
    const color = $(this).val();
    folder.css('--folder-color', color);
    folder.find('.bb-folder-title, .bb-folder-edit-main').css('color', color);
    saveLayoutMain();
});

$('body').off('click', '.bb-folder-edit-main').on('click', '.bb-folder-edit-main', function() {
    const folder = $(this).closest('.bb-folder');
    const oldName = folder.attr('data-name');
    const newName = prompt("Новое имя папки:", oldName);
    if (newName && newName.trim() && newName.trim() !== oldName) {
        folder.attr('data-name', newName.trim());
        folder.find('.bb-folder-title').text('📁 ' + newName.trim());
        saveLayoutMain();
    }
});

function saveLayoutMain() {
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
                    const eName = getTitle(this);
                    if (eName) layout.folders[fName].items.push(eName);
                });
            } else {
                const eName = getTitle(this);
                if (eName) arr.push({ type: 'ext', title: eName });
            }
        });
    };

    processCol('#extensions_settings', layout.left);
    processCol('#extensions_settings2', layout.right);

    extension_settings[MODULE_NAME].layout = layout;
    saveSettingsDebounced();
}

function restoreLayout() {
    const layout = extension_settings[MODULE_NAME].layout;
    if (!layout || !layout.folders) return;

    Object.keys(layout.folders).forEach(fName => {
        const folderData = layout.folders[fName];
        const color = folderData.color || '#a855f7'; 
        createFolderElement(fName, color);
    });

    const processCol = (colId, itemsArr) => {
        const col = $(colId);
        itemsArr.forEach(item => {
            if (item.type === 'folder') {
                const folder = $(`.bb-folder[data-name="${item.title}"]`);
                col.append(folder);
                const folderData = layout.folders[item.title];
                const items = Array.isArray(folderData) ? folderData : folderData.items;
                if (items) {
                    items.forEach(extTitle => {
                        const ext = findExtension(extTitle);
                        if (ext) folder.find('.bb-folder-content').append(ext);
                    });
                }
            } else {
                const ext = findExtension(item.title);
                if (ext) col.append(ext);
            }
        });
    };

    if (layout.left) processCol('#extensions_settings', layout.left);
    if (layout.right) processCol('#extensions_settings2', layout.right);
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

    let foundExts = new Set();
    
    const getExtHtml = (el) => {
        if (!isRealExtension(el)) return ''; 
        const eName = getTitle(el);
        if (eName && !foundExts.has(eName)) {
            foundExts.add(eName);
            // Добавил иконку-ручку (.bb-drag-handle) перед пазлом
            return `<div class="bb-light-item" data-type="ext" data-title="${eName}">
                        <i class="fa-solid fa-grip-vertical bb-drag-handle"></i>
                        <i class="fa-solid fa-puzzle-piece"></i> ${eName}
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
                html += `
                    <div class="bb-light-item bb-light-folder" data-type="folder" data-title="${fName}" data-color="${fColor}" style="--folder-color: ${fColor};">
                        <div class="bb-light-folder-header">
                            <i class="fa-solid fa-grip-vertical bb-drag-handle" style="margin-right: 8px;"></i>
                            <i class="fa-solid fa-folder" style="color: var(--folder-color);"></i> <b class="folder-title-text" style="color: var(--folder-color);">${fName}</b>
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
            $('#bb-modal-left').append(`
                <div class="bb-light-item bb-light-folder" data-type="folder" data-title="${name}" data-color="#a855f7" style="--folder-color: #a855f7;">
                    <div class="bb-light-folder-header">
                        <i class="fa-solid fa-grip-vertical bb-drag-handle" style="margin-right: 8px;"></i>
                        <i class="fa-solid fa-folder" style="color: var(--folder-color);"></i> <b class="folder-title-text" style="color: var(--folder-color);">${name}</b>
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

    $('#bb-modal-cancel').on('click', () => $('#bb-sort-modal-overlay').remove());

    $('#bb-modal-save').on('click', () => {
        const layout = { left: [], right: [], folders: {} };
        const realLeftCol = $('#extensions_settings');
        const realRightCol = $('#extensions_settings2');
        
        const applyColumn = (modalColId, realCol, targetArray) => {
            $(modalColId).find('> .bb-light-item').each(function() {
                const type = $(this).attr('data-type');
                const title = $(this).attr('data-title');
                
                if (type === 'folder') {
                    const color = $(this).attr('data-color') || '#a855f7';
                    createFolderElement(title, color); 
                    
                    const realFolder = $(`.bb-folder[data-name="${title}"]`);
                    realFolder.css('--folder-color', color);
                    realFolder.find('.bb-color-picker').val(color);
                    realFolder.find('.bb-folder-title, .bb-folder-edit-main').css('color', color);

                    realCol.append(realFolder);
                    targetArray.push({ type: 'folder', title: title });
                    layout.folders[title] = { color: color, items: [] };
                    
                    $(this).find('.bb-light-folder-content > div').each(function() {
                        const extTitle = $(this).attr('data-title');
                        const realExt = findExtension(extTitle);
                        if (realExt) {
                            realFolder.find('.bb-folder-content').append(realExt);
                            layout.folders[title].items.push(extTitle);
                        }
                    });
                } else {
                    const realExt = findExtension(title);
                    if (realExt) {
                        realCol.append(realExt);
                        targetArray.push({ type: 'ext', title: title });
                    }
                }
            });
        };

        applyColumn('#bb-modal-left', realLeftCol, layout.left);
        applyColumn('#bb-modal-right', realRightCol, layout.right);

        $('.bb-folder').each(function() {
            const fName = $(this).attr('data-name');
            if (!layout.folders[fName]) $(this).remove();
        });

        extension_settings[MODULE_NAME].layout = layout;
        saveSettingsDebounced();
        $('#bb-sort-modal-overlay').remove();
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
                
                let checkAttempts = 0;
                let heartbeat = setInterval(() => {
                    restoreLayout();
                    checkAttempts++;
                    if (checkAttempts >= 5) clearInterval(heartbeat);
                }, 2000);

            }, 2000);
        });
    } catch (e) {
        console.error("[BB Sorter] Ошибка:", e);
    }
});
