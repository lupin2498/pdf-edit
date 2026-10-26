// Settings and About dialogs.
import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { openDialog, confirmDialog, toast } from '../ui/dialogs.js';
import { settings, saveSettings } from '../settings.js';
import { t, getLanguage, LANGUAGES } from '../i18n.js';

export async function open(app) {
  const lang = h('select', { class: 'input' }, LANGUAGES.map((l) => h('option', { value: l.id, selected: l.id === getLanguage() }, l.label)));
  const theme = h('select', { class: 'input' }, h('option', { value: 'light', selected: settings.theme !== 'dark' }, t('settings.light')), h('option', { value: 'dark', selected: settings.theme === 'dark' }, t('settings.dark')));
  const author = h('input', { class: 'input', value: settings.author || '' });
  author.addEventListener('keydown', (e) => e.stopPropagation());
  const res = await openDialog({
    title: t('settings.title'),
    content: [
      h('div', { class: 'form-row' }, h('label', null, t('settings.language')), lang),
      h('div', { class: 'form-row' }, h('label', null, t('settings.theme')), theme),
      h('div', { class: 'form-row' }, h('label', null, t('settings.author')), author, h('div', { class: 'hint' }, t('settings.authorHint'))),
      h('div', { class: 'hint' }, t('settings.defaultApp')),
    ],
    buttons: [
      { label: t('common.cancel'), value: null },
      { label: t('common.save'), primary: true, onClick: () => ({ language: lang.value, theme: theme.value, author: author.value.trim() }) },
    ],
  }).promise;
  if (!res) return;
  const langChanged = res.language !== getLanguage();
  await saveSettings(res);
  document.documentElement.dataset.theme = res.theme === 'dark' ? 'dark' : 'light';
  if (langChanged) {
    const hasDocs = app.tabs.some((tb) => tb.kind === 'doc');
    if (!hasDocs || (await confirmDialog(t('settings.reloadConfirm')))) {
      if (!hasDocs) location.reload();
      else {
        for (const tb of [...app.tabs]) if (tb.kind === 'doc' && !(await app.closeTab(tb))) return;
        location.reload();
      }
    } else toast(t('settings.restartNote'));
  }
}

export async function about(app) {
  const info = app.info || {};
  await openDialog({
    title: t('about.title'),
    content: [
      h('div', { class: 'form-inline' }, icon('logo'), h('b', { style: { fontSize: '18px' } }, t('app.name')), h('span', { class: 'hint' }, `v${info.version || ''}`)),
      h('div', null, t('about.description')),
      h('div', { class: 'hint' }, t('about.licenses')),
      h('div', { class: 'hint' }, 'pdf.js (Apache-2.0) · pdf-lib / @cantoo/pdf-lib (MIT) · fontkit (MIT) · fflate (MIT) · Electron (MIT) · Liberation Fonts (SIL OFL 1.1)'),
    ],
    buttons: [{ label: t('common.close'), primary: true }],
  }).promise;
}
